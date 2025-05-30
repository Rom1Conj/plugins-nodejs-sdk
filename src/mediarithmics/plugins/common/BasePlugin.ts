/* eslint-disable @typescript-eslint/require-await */

import bodyParser from 'body-parser';
import express from 'express';
import _ from 'lodash';
import cache from 'memory-cache';
import request from 'request';
import rp from 'request-promise-native';
import toobusy from 'toobusy-js';
import winston from 'winston';

import { Compartment, DataListResponse, SimpleResponse } from '../../';
import { Datamart } from '../../api/core/datamart/Datamart';
import {
  AdLayoutProperty,
  asAdLayoutProperty,
  asAssetFileProperty,
  asAssetFolderProperty,
  asBooleanProperty,
  asDataFileProperty,
  asNativeDataProperty,
  asNativeImageProperty,
  asNativeTitleProperty,
  AssetFileProperty,
  AssetFolderProperty,
  asStringProperty,
  asUrlProperty,
  BooleanProperty,
  DataFileProperty,
  NativeDataProperty,
  NativeImageProperty,
  NativeTitleProperty,
  PluginProperty,
  PropertyType,
  StringProperty,
  UrlProperty,
} from '../../api/core/plugin/PluginPropertyInterface';
import { flatMap, Index, obfuscateString, Option } from '../../utils';
import { normalizeArray } from '../../utils/Normalizer';
import { MsgCmd, SocketMsg } from './index';

export interface InitUpdateResponse {
  status: ResponseStatusCode;
  msg?: string;
}

export interface LogLevelUpdateResponse {
  status: ResponseStatusCode;
  msg?: string;
}

export interface Credentials {
  authentication_token: string;
  worker_id: string;
}

export type ResponseStatusCode = 'ok' | 'error';

export interface ResponseError {
  name: string;
  response: { statusCode: number; statusMessage: string; body: unknown };
}

export class ResourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceNotFoundError';
  }
}

export class PropertiesWrapper {
  readonly normalized: Index<PluginProperty>;

  constructor(readonly values: Array<PluginProperty>) {
    this.normalized = normalizeArray(values, 'technical_name');
  }

  get = (key: string): Option<PluginProperty> => this.normalized[key];

  ofType = (typeName: PropertyType): Option<PluginProperty> => _.find(this.values, (p) => p.property_type === typeName);

  findAssetFileProperty = (key?: string): Option<AssetFileProperty> => {
    const p = key ? this.get(key) : this.ofType('ASSET') || this.ofType('ASSET_FILE');
    return flatMap(p, asAssetFileProperty);
  };

  findAssetFolderProperty = (key?: string): Option<AssetFolderProperty> => {
    const p = key ? this.get(key) : this.ofType('ASSET_FOLDER');
    return flatMap(p, asAssetFolderProperty);
  };

  findDataFileProperty = (key?: string): Option<DataFileProperty> => {
    const p = key ? this.get(key) : this.ofType('DATA_FILE');
    return flatMap(p, asDataFileProperty);
  };

  findUrlProperty = (key?: string): Option<UrlProperty> => {
    const p = key ? this.get(key) : this.ofType('URL');
    return flatMap(p, asUrlProperty);
  };

  findStringProperty = (key?: string): Option<StringProperty> => {
    const p = key ? this.get(key) : this.ofType('STRING');
    return flatMap(p, asStringProperty);
  };

  findAdLayoutProperty = (key?: string): Option<AdLayoutProperty> => {
    const p = key ? this.get(key) : this.ofType('AD_LAYOUT');
    return flatMap(p, asAdLayoutProperty);
  };

  findBooleanProperty = (key?: string): Option<BooleanProperty> => {
    const p = key ? this.get(key) : this.ofType('BOOLEAN');
    return flatMap(p, asBooleanProperty);
  };

  findNativeDataProperty = (key?: string): Option<NativeDataProperty> => {
    const p = key ? this.get(key) : this.ofType('NATIVE_DATA');
    return flatMap(p, asNativeDataProperty);
  };

  findNativeTitleProperty = (key?: string): Option<NativeTitleProperty> => {
    const p = key ? this.get(key) : this.ofType('NATIVE_TITLE');
    return flatMap(p, asNativeTitleProperty);
  };

  findNativeImageProperty = (key?: string): Option<NativeImageProperty> => {
    const p = key ? this.get(key) : this.ofType('NATIVE_IMAGE');
    return flatMap(p, asNativeImageProperty);
  };
}

export abstract class BasePlugin<CacheValue = unknown> {
  multiThread = false;

  // Default cache is now 10 min to give some breathing to the Gateway
  // Note: This will be private or completly remove in the next major release as a breaking change
  // TODO: in 0.8.x+, make this private or remove it completly (this should no longer be overriden in plugin impl.,
  // or we should implement a minimum threshold pattern)
  INSTANCE_CONTEXT_CACHE_EXPIRATION = 600000;

  pluginCache: cache.CacheClass<string, Promise<CacheValue>>;

  gatewayHost: string;
  gatewayPort: number;
  outboundPlatformUrl: string;

  app: express.Application;
  logger: winston.Logger;
  credentials: Credentials;

  _transport = rp;

  enableThrottling = false; // Log level update implementation

  // The idea here is to add a random part in the instance cache expiration -> we add +0-10% variablity

  constructor(enableThrottling = false) {
    if (enableThrottling) {
      this.enableThrottling = enableThrottling;
    }
    const gatewayHost = process.env.GATEWAY_HOST;
    if (gatewayHost) {
      this.gatewayHost = gatewayHost;
    } else {
      this.gatewayHost = 'plugin-gateway.platform';
    }

    const gatewayPort = process.env.GATEWAY_PORT;
    if (gatewayPort) {
      this.gatewayPort = parseInt(gatewayPort);
    } else {
      this.gatewayPort = 8080;
    }

    this.outboundPlatformUrl = `http://${this.gatewayHost}:${this.gatewayPort}`;

    this.app = express();

    if (this.enableThrottling) {
      this.app.use((req, res, next) => {
        if (
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          toobusy() &&
          !(
            req.path === '/v1/init' ||
            req.path === '/v1/status' ||
            req.path === '/v1/shutdown' ||
            req.path === '/v1/log_level'
          )
        ) {
          res.status(429).json({ status: 'RETRY', message: "I'm busy right now, sorry." });
        } else {
          next();
        }
      });
    }

    this.app.use(bodyParser.raw({ type: 'application/ion', limit: '5mb' }));
    this.app.use(bodyParser.json({ type: '*/*', limit: '5mb' }));

    this.logger = winston.createLogger({
      transports: [
        new winston.transports.Console({
          format: winston.format.json(),
        }),
      ],
    });

    this.pluginCache = cache;
    this.pluginCache.clear();

    if (!process.env.PLUGIN_WORKER_ID) {
      throw new Error('Missing worker id in the environment!');
    }
    if (!process.env.PLUGIN_AUTHENTICATION_TOKEN) {
      throw new Error('Missing auth token in the environment!');
    }
    this.credentials = {
      authentication_token: process.env.PLUGIN_AUTHENTICATION_TOKEN,
      worker_id: process.env.PLUGIN_WORKER_ID,
    };

    this.initInitRoute();
    this.initStatusRoute();
    this.initLogLevelUpdateRoute();
    this.initLogLevelGetRoute();
    this.initMetadataRoute();
  }

  // The objective is to stop having 'synchronized' instance context re-build that are putting some stress on the gateway due to burst of API calls
  getInstanceContextCacheExpiration() {
    return this.INSTANCE_CONTEXT_CACHE_EXPIRATION * (1 + 0.1 * Math.random());
  }

  // Log level update implementation

  onLogLevelUpdate(level: string) {
    const logLevel = level.toLowerCase();
    this.logger.info('Setting log level to ' + logLevel);
    this.logger.level = logLevel;
  }

  fetchDataFile(uri: string): Promise<Buffer> {
    return this.requestGatewayHelper(
      'GET',
      `${this.outboundPlatformUrl}/v1/data_file/data`,
      undefined,
      { uri: uri },
      false,
      true,
    );
  }

  // Log level update implementation

  fetchConfigurationFile(fileName: string): Promise<Buffer> {
    return this.requestGatewayHelper(
      'GET',
      `${this.outboundPlatformUrl}/v1/configuration/technical_name=${fileName}`,
      undefined,
      undefined,
      false,
      true,
    );
  }

  upsertConfigurationFile(fileName: string, fileContent: Buffer): Promise<SimpleResponse> {
    return this.requestGatewayHelper(
      'PUT',
      `${this.outboundPlatformUrl}/v1/configuration/technical_name=${fileName}`,
      fileContent,
      undefined,
      false,
      true,
    );
  }

  async requestGatewayHelper<T>(
    method: string,
    uri: string,
    body?: unknown,
    qs?: unknown,
    isJson?: boolean,
    isBinary?: boolean,
  ): Promise<T> {
    const options: request.OptionsWithUri = {
      method: method,
      uri: uri,
      auth: {
        user: this.credentials.worker_id,
        pass: this.credentials.authentication_token,
        sendImmediately: true,
      },
      proxy: false,
    };

    // Set the body if provided
    options.body = body !== undefined ? body : undefined;

    // Set the querystring if provided
    options.qs = qs !== undefined ? qs : undefined;

    // Set the json flag if provided
    options.json = isJson !== undefined ? isJson : true;

    // Set the encoding to null if it is binary
    options.encoding = isBinary !== undefined && isBinary ? null : undefined;

    this.logger.silly(`Doing gateway call with ${JSON.stringify(options)}`);

    try {
      return (await this._transport(options)) as T;
    } catch (e) {
      const error = e as ResponseError;
      if (error.name === 'StatusCodeError') {
        const bodyString = (isJson !== undefined && !isJson ? body : JSON.stringify(body)) as string;
        const message = `Error while calling ${method} '${uri}' with the request body '${bodyString || ''}', the qs '${
          JSON.stringify(qs) || ''
        }', the auth user '${
          obfuscateString(options.auth ? options.auth.user : undefined) || ''
        }', the auth password '${obfuscateString(options.auth ? options.auth.pass : undefined) || ''}': got a ${
          error.response.statusCode
        } ${error.response.statusMessage} with the response body ${JSON.stringify(error.response.body)}`;

        if (error.response.statusCode === 404) {
          throw new ResourceNotFoundError(message);
        } else {
          throw new Error(message);
        }
      } else {
        this.logger.error(
          `Got an issue while doing a Gateway call: ${(e as Error).message} - ${
            (e as Error).stack ? ((e as Error).stack as string) : 'stack undefined'
          }`,
        );
        throw e;
      }
    }
  }

  // Health Status implementation

  async requestPublicMicsApiHelper<T>(apiToken: string, options: rp.OptionsWithUri): Promise<T> {
    const tweakedOptions = {
      ...options,
      headers: {
        ...options.headers,
        Authorization: apiToken,
      },
      proxy: false,
    };

    try {
      return (await this._transport(tweakedOptions)) as T;
    } catch (e) {
      const error = e as ResponseError;
      if (error.name === 'StatusCodeError') {
        throw new Error(
          `Error while calling ${options.method as string} '${
            options.uri as string
          }' with the header body '${JSON.stringify(options.headers)}': got a ${error.response.statusCode} ${
            error.response.statusMessage
          } with the response body ${JSON.stringify(error.response.body)}`,
        );
      } else {
        this.logger.error(
          `Got an issue while doing a mediarithmics API call: ${(e as Error).message} - ${
            (e as Error).stack ? ((e as Error).stack as string) : 'stack undefined'
          }`,
        );
        throw e;
      }
    }
  }

  async fetchDatamarts(apiToken: string, organisationId: string): Promise<DataListResponse<Datamart>> {
    const options = {
      method: 'GET',
      uri: 'https://api.mediarithmics.com/v1/datamarts',
      qs: { organisation_id: organisationId, allow_administrator: 'false' },
      json: true,
    };

    return this.requestPublicMicsApiHelper(apiToken, options);
  }

  async fetchDatamartCompartments(apiToken: string, datamartId: string): Promise<DataListResponse<Compartment>> {
    const options = {
      method: 'GET',
      uri: `https://api.mediarithmics.com/v1/datamarts/${datamartId}/user_account_compartments`,
      json: true,
    };

    return this.requestPublicMicsApiHelper(apiToken, options);
  }

  onInitRequest(creds: Credentials) {
    this.credentials.authentication_token = creds.authentication_token;
    this.credentials.worker_id = creds.worker_id;
    this.logger.info('Update authentication_token with %s', this.credentials.authentication_token);
  }

  // Method to start the plugin
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  start() {}

  protected httpIsReady() {
    return this.credentials && this.credentials.worker_id && this.credentials.authentication_token;
  }

  // This method can be overridden by any subclass
  protected onLogLevelUpdateHandler(req: express.Request, res: express.Response) {
    const body = req.body as { level?: string };
    if (body && body.level) {
      const { level } = body;

      if (this.multiThread) {
        const msg: SocketMsg = {
          value: level.toLowerCase(),
          cmd: MsgCmd.LOG_LEVEL_UPDATE_FROM_WORKER,
        };

        this.logger.debug(
          `Sending DEBUG_LEVEL_UPDATE_FROM_WORKER from worker ${process.pid} to master with value: ${
            msg.value ? msg.value : 'undefiend'
          }`,
        );

        if (typeof process.send === 'function') {
          process.send(msg);
        }

        // We have to assume that everything went fine in the propagation...
        res.status(200).end();
      } else {
        // Lowering case

        this.onLogLevelUpdate(level);

        return res.status(200).end();
      }
    } else {
      this.logger.error('Incorrect body : Cannot change log level, actual: ' + this.logger.level);
      res.status(400).end();
    }
  }

  // This method can be overridden by any subclass
  protected onLogLevelRequest(req: express.Request, res: express.Response) {
    res.send({ level: this.logger.level.toUpperCase() });
  }

  // This method can be overridden by any subclass
  protected onStatusRequest(req: express.Request, res: express.Response) {
    //Route used by the plugin manager to check if the plugin is UP and running
    this.logger.silly('GET /v1/status');
    if (this.httpIsReady()) {
      res.status(200).end();
    } else {
      this.logger.error(`Plugin is not inialized yet, we don't have any worker_id & authentification_token`);
      res.status(503).end();
    }
  }

  // Plugin Init implementation

  protected asyncMiddleware =
    (fn: (req: express.Request, res: express.Response, next: express.NextFunction) => unknown) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };

  protected setErrorHandler() {
    this.app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      this.logger.error(`Something bad happened : ${err.message} - ${err.stack ? err.stack : 'stack undefined'}`);
      return res.status(500).send(`${err.message} \n ${err.stack ? err.stack : 'stack undefined'}`);
    });
  }

  private initLogLevelUpdateRoute() {
    //Route used by the plugin manager to check if the plugin is UP and running
    this.app.put(
      '/v1/log_level',

      this.asyncMiddleware(async (req: express.Request, res: express.Response) => {
        this.onLogLevelUpdateHandler(req, res);
      }),
    );
  }

  private initLogLevelGetRoute() {
    this.app.get(
      '/v1/log_level',
      this.asyncMiddleware(async (req: express.Request, res: express.Response) => {
        this.onLogLevelRequest(req, res);
      }),
    );
  }

  private initStatusRoute() {
    this.app.get(
      '/v1/status',
      this.asyncMiddleware(async (req: express.Request, res: express.Response) => {
        this.onStatusRequest(req, res);
      }),
    );
  }

  private initInitRoute() {
    this.app.post(
      '/v1/init',
      this.asyncMiddleware(async (req: express.Request, res: express.Response) => {
        // not useful anymore, keep it during the migration phase
        res.status(200).end();
      }),
    );
  }

  public getMetadata() {
    const dependencies: any = {};

    try {
      dependencies['@mediarithmics/plugins-nodejs-sdk'] = require(
        process.cwd() + '/node_modules/@mediarithmics/plugins-nodejs-sdk/package.json',
      )?.version;
    } catch (err) {}

    return {
      runtime: 'node',
      runtime_version: process.version,
      group_id: process.env.PLUGIN_GROUP_ID,
      artifact_id: process.env.PLUGIN_ARTIFACT_ID,
      plugin_type: process.env.PLUGIN_TYPE,
      plugin_version: process.env.PLUGIN_VERSION,
      plugin_build: process.env.PLUGIN_BUILD,
      dependencies,
    };
  }

  private initMetadataRoute() {
    this.app.get(
      '/v1/metadata',
      this.asyncMiddleware(async (req: express.Request, res: express.Response) => {
        try {
          res.status(200).send(this.getMetadata());
        } catch (err) {
          res.status(500).send({ status: 'error', message: `${(err as Error).message}` });
        }
      }),
    );
  }
}
