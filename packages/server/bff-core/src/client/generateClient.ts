import * as path from 'path';
import type { HttpMethodDecider } from '@modern-js/types';
import { ApiRouter } from '../router';
import { type Result, Ok, Err } from './result';

export type GenClientResult = Result<string>;

export type GenClientOptions = {
  resourcePath: string;
  source: string;
  appDir: string;
  apiDir: string;
  lambdaDir: string;
  prefix: string;
  port: number;
  requestCreator?: string;
  fetcher?: string;
  target?: string;
  requireResolve?: typeof require.resolve;
  httpMethodDecider?: HttpMethodDecider;
};

export const DEFAULT_CLIENT_REQUEST_CREATOR = '@modern-js/create-request';

export const generateClient = async ({
  appDir,
  resourcePath,
  apiDir,
  lambdaDir,
  prefix,
  port,
  target,
  requestCreator,
  fetcher,
  requireResolve = require.resolve,
  httpMethodDecider,
}: GenClientOptions): Promise<GenClientResult> => {
  if (!requestCreator) {
    requestCreator = requireResolve(
      `${DEFAULT_CLIENT_REQUEST_CREATOR}${target ? `/${target}` : ''}`,
    ).replace(/\\/g, '/');
  } else {
    // 这里约束传入的 requestCreator 包也必须有两个导出 client 和 server，因为目前的机制 client 和 server 要导出不同的 configure 函数；该 api 不对使用者暴露，后续可优化
    let resolvedPath = requestCreator;
    try {
      resolvedPath = path.dirname(requireResolve(requestCreator));
    } catch (error) {}
    requestCreator = `${resolvedPath}${target ? `/${target}` : ''}`.replace(
      /\\/g,
      '/',
    );
  }

  const apiRouter = new ApiRouter({
    appDir,
    apiDir,
    lambdaDir,
    prefix,
    httpMethodDecider,
  });

  const handlerInfos = await apiRouter.getSingleModuleHandlers(resourcePath);
  if (!handlerInfos) {
    return Err(`generate client error: Cannot require module ${resourcePath}`);
  }

  let handlersCode = '';
  for (const handlerInfo of handlerInfos) {
    const { name, httpMethod, routePath } = handlerInfo;
    let exportStatement = `var ${name} =`;
    if (name.toLowerCase() === 'default') {
      exportStatement = 'default';
    }
    const upperHttpMethod = httpMethod.toUpperCase();

    const routeName = routePath;
    if (target === 'server') {
      handlersCode += `export ${exportStatement} createRequest('${routeName}', '${upperHttpMethod}', process.env.PORT || ${String(
        port,
      )}, '${httpMethodDecider ? httpMethodDecider : 'functionName'}' ${
        fetcher ? `, fetch` : ''
      });
      `;
    } else {
      handlersCode += `export ${exportStatement} createRequest('${routeName}', '${upperHttpMethod}', ${String(
        port,
      )}, '${httpMethodDecider ? httpMethodDecider : 'functionName'}' ${
        fetcher ? `, fetch` : ''
      });
      `;
    }
  }

  const importCode = `import { createRequest } from '${requestCreator}';
${fetcher ? `import { fetch } from '${fetcher}';\n` : ''}`;

  return Ok(`${importCode}\n${handlersCode}`);
};
