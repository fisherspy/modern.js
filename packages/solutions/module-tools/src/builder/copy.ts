import path from 'path';
import { watch, fs, chalk, logger, globby, fastGlob } from '@modern-js/utils';
import type { CopyOptions, CopyPattern } from '../types/config/copy';
import type { BaseBuildConfig } from '../types/config';
import pMap from '../../compiled/p-map';
import { debug } from '../debug';

const watchMap = new Map<string, string>();

export const runPatterns = async (
  pattern: CopyPattern,
  options: {
    appDirectory: string;
    enableCopySync?: boolean;
    outDir: string;
    defaultContext: string;
    watch?: boolean;
  },
) => {
  const { default: normalizePath } = await import(
    '../../compiled/normalize-path'
  );
  const { appDirectory, enableCopySync = false } = options;
  const { from, globOptions = {} } = pattern;
  const targetPattern: CopyPattern = { ...pattern };
  const normalizedFrom = path.normalize(from);
  const defaultAbsContext = options.defaultContext;

  // when context is relative path
  if (typeof pattern.context === 'string') {
    targetPattern.context = path.isAbsolute(pattern.context)
      ? pattern.context
      : path.join(appDirectory, pattern.context);
  } else {
    targetPattern.context = defaultAbsContext;
  }

  let absoluteFrom;
  if (path.isAbsolute(normalizedFrom)) {
    absoluteFrom = normalizedFrom;
  } else {
    absoluteFrom = path.resolve(targetPattern.context, normalizedFrom);
  }

  let stats;
  try {
    stats = await fs.stat(absoluteFrom);
  } catch (error) {
    // Do Nothing
  }

  let fromType: 'file' | 'dir' | 'glob';
  if (stats) {
    if (stats.isDirectory()) {
      fromType = 'dir';
    } else if (stats.isFile()) {
      fromType = 'file';
    } else {
      fromType = 'glob';
    }
  } else {
    fromType = 'glob';
  }

  let glob;

  switch (fromType) {
    case 'dir':
      targetPattern.context = absoluteFrom;
      glob = path.posix.join(
        fastGlob.escapePath(normalizePath(path.resolve(absoluteFrom))),
        '**/*',
      );
      absoluteFrom = path.join(absoluteFrom, '**/*');

      if (typeof globOptions.dot === 'undefined') {
        globOptions.dot = true;
      }
      break;
    case 'file':
      targetPattern.context = path.dirname(absoluteFrom);
      glob = fastGlob.escapePath(normalizePath(path.resolve(absoluteFrom)));

      if (typeof globOptions.dot === 'undefined') {
        globOptions.dot = true;
      }
      break;
    default: {
      glob = path.isAbsolute(from)
        ? from
        : path.posix.join(
            fastGlob.escapePath(
              normalizePath(
                path.resolve(targetPattern.context ?? appDirectory),
              ),
            ),
            from,
          );
    }
  }

  const globEntries = await globby(glob, {
    ...{ followSymbolicLinks: true },
    ...(targetPattern.globOptions || {}),
    cwd: targetPattern.context,
    objectMode: true,
  });

  pMap(globEntries, async globEntry => {
    if (!globEntry.dirent.isFile()) {
      return;
    }

    const from = globEntry.path;
    const absoluteFrom = path.resolve(targetPattern.context!, from);
    const to = path.normalize(
      typeof targetPattern.to !== 'undefined' ? targetPattern.to : '',
    );
    const toType =
      path.extname(to) === '' || to.slice(-1) === path.sep ? 'dir' : 'file';

    const relativeFrom = path.relative(
      targetPattern.context ?? defaultAbsContext,
      absoluteFrom,
    );

    const filename = toType === 'dir' ? path.join(to, relativeFrom) : to;

    const absoluteTo = path.isAbsolute(filename)
      ? filename
      : path.join(options.outDir, filename);

    if (options.watch) {
      watchMap.set(absoluteFrom, absoluteTo);
    }

    if (enableCopySync) {
      fs.copySync(absoluteFrom, absoluteTo);
    } else {
      await fs.copy(absoluteFrom, absoluteTo);
    }
  });
};

export const watchCopyFiles = async (
  options: {
    appDirectory: string;
  },
  copyConfig: CopyOptions,
) => {
  debug('watchMap', watchMap);

  const watchList = Array.from(watchMap.keys());

  debug('watchList', watchList);

  watch(watchList, async ({ changedFilePath, changeType }) => {
    const result = watchMap.get(changedFilePath);
    if (!result) {
      return;
    }

    const formatFilePath = path.relative(options.appDirectory, changedFilePath);

    if (changeType === 'unlink') {
      fs.remove(result);
      logger.info(`Copied file removed: ${chalk.dim(formatFilePath)}`);
      return;
    }

    if (copyConfig?.options?.enableCopySync) {
      fs.copySync(changedFilePath, result);
    } else {
      await fs.copy(changedFilePath, result);
    }

    logger.info(`Copy file: ${chalk.dim(formatFilePath)}`);
  });
};

export const copyTask = async (
  buildConfig: BaseBuildConfig,
  options: {
    appDirectory: string;
    watch?: boolean;
  },
) => {
  const copyConfig = buildConfig.copy;

  if (!copyConfig.patterns || copyConfig.patterns.length === 0) {
    return;
  }
  debug('run copy task');
  const concurrency = copyConfig?.options?.concurrency || 100;
  try {
    await pMap(
      copyConfig.patterns,
      async copyOption => {
        await runPatterns(copyOption, {
          ...options,
          enableCopySync: copyConfig.options?.enableCopySync,
          outDir: buildConfig.outDir,
          defaultContext: buildConfig.sourceDir,
        });
      },
      { concurrency },
    );
  } catch (e) {
    if (e instanceof Error) {
      logger.error(`copy error: ${e.message}`);
    }
  }
  debug('run copy task done');

  if (options.watch) {
    await watchCopyFiles(options, copyConfig);
  }
};
