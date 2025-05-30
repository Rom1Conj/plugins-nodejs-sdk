/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unused-vars */

import 'mocha';

import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';

import { core } from '../';
import { AudienceFeedBatchContext, UserSegmentUpdatePluginFileDeliveryResponseData } from '../mediarithmics';
import { BatchUpdateRequest } from '../mediarithmics/api/core/batchupdate/BatchUpdateInterface';

const PLUGIN_AUTHENTICATION_TOKEN = 'Manny';
const PLUGIN_WORKER_ID = 'Calavera';

// set by the plugin runner in production
process.env.PLUGIN_AUTHENTICATION_TOKEN = PLUGIN_AUTHENTICATION_TOKEN;
process.env.PLUGIN_WORKER_ID = PLUGIN_WORKER_ID;

class MyFakeAudienceFeedConnector extends core.AudienceFeedConnectorBasePlugin {
  protected onExternalSegmentCreation(
    request: core.ExternalSegmentCreationRequest,
    instanceContext: core.AudienceFeedConnectorBaseInstanceContext,
  ): Promise<core.ExternalSegmentCreationPluginResponse> {
    const response: core.ExternalSegmentCreationPluginResponse = {
      status: 'ok',
    };
    return Promise.resolve(response);
  }

  protected onExternalSegmentConnection(
    request: core.ExternalSegmentConnectionRequest,
    instanceContext: core.AudienceFeedConnectorBaseInstanceContext,
  ): Promise<core.ExternalSegmentConnectionPluginResponse> {
    const response: core.ExternalSegmentConnectionPluginResponse = {
      status: 'ok',
    };
    return Promise.resolve(response);
  }

  protected onUserSegmentUpdate(
    request: core.UserSegmentUpdateRequest,
    instanceContext: core.AudienceFeedConnectorBaseInstanceContext,
  ): Promise<core.UserSegmentUpdatePluginResponse> {
    const data: UserSegmentUpdatePluginFileDeliveryResponseData[] = [
      { type: 'FILE_DELIVERY', content: 'my_string', grouping_key: 'groupingKey', destination_token: 'destination_1' },
    ];

    const response: core.UserSegmentUpdatePluginResponse = {
      status: 'ok',
      data,
    };

    return Promise.resolve(response);
  }
}

const rpMockup: sinon.SinonStub = sinon.stub().returns(
  new Promise((resolve, reject) => {
    resolve('Yolo');
  }),
);

describe('Fetch Audience Feed Gateway API', () => {
  // All the magic is here
  const plugin = new MyFakeAudienceFeedConnector(false);
  const runner = new core.TestingPluginRunner(plugin, rpMockup);

  it('Check that feed_id is passed correctly in fetchAudienceFeedProperties', function (done) {
    const fakeId = '42000000';

    // We try a call to the Gateway
    void (runner.plugin as MyFakeAudienceFeedConnector).fetchAudienceFeedProperties(fakeId).then(() => {
      expect(rpMockup.args[0][0].uri).to.be.eq(
        `${runner.plugin.outboundPlatformUrl}/v1/audience_segment_external_feeds/${fakeId}/properties`,
      );
      done();
    });
  });

  it('Check that feed_id is passed correctly in fetchAudienceSegment', function (done) {
    const fakeId = '42000000';

    // We try a call to the Gateway
    void (runner.plugin as MyFakeAudienceFeedConnector).fetchAudienceSegment(fakeId).then(() => {
      expect(rpMockup.args[1][0].uri).to.be.eq(
        `${runner.plugin.outboundPlatformUrl}/v1/audience_segment_external_feeds/${fakeId}/audience_segment`,
      );
      done();
    });
  });
});

describe.only('External Audience Feed API test', function () {
  // All the magic is here
  const plugin = new MyFakeAudienceFeedConnector(false);
  let runner: core.TestingPluginRunner;

  it('Check that the plugin is giving good results with a simple handler', function (done) {
    const rpMockup: sinon.SinonStub = sinon.stub();

    const audienceFeed: core.DataResponse<core.AudienceSegmentExternalFeedResource> = {
      status: 'ok',
      data: {
        id: '74',
        plugin_id: '984',
        organisation_id: '95',
        group_id: 'com.mediarithmics.audience-feed',
        artifact_id: 'awesome-audience-feed',
        version_id: '1254',
      },
    };

    rpMockup
      .withArgs(
        sinon.match.has(
          'uri',
          sinon.match(function (value: string) {
            return value.match(/\/v1\/audience_segment_external_feeds\/(.){1,10}/) !== null;
          }),
        ),
      )
      .returns(audienceFeed);

    const properties: core.DataListResponse<core.PluginProperty> = {
      status: 'ok',
      count: 1,
      data: [
        {
          technical_name: 'hello_world',
          value: {
            value: 'Yay',
          },
          property_type: 'STRING',
          origin: 'PLUGIN',
          writable: true,
          deletable: false,
        },
      ],
    };

    rpMockup
      .withArgs(
        sinon.match.has(
          'uri',
          sinon.match(function (value: string) {
            return value.match(/\/v1\/audience_segment_external_feeds\/(.){1,10}\/properties/) !== null;
          }),
        ),
      )
      .returns(properties);

    runner = new core.TestingPluginRunner(plugin, rpMockup);

    const externalSegmentCreation: core.ExternalSegmentCreationRequest = {
      feed_id: '42',
      datamart_id: '1023',
      segment_id: '451256',
    };

    const externalSegmentConnection: core.ExternalSegmentConnectionRequest = {
      feed_id: '42',
      datamart_id: '1023',
      segment_id: '451256',
    };

    const userSegmentUpdateRequest: core.UserSegmentUpdateRequest = {
      feed_id: '42',
      session_id: '43',
      datamart_id: '1023',
      segment_id: '451256',
      ts: 1254412,
      operation: 'UPSERT',
      user_identifiers: [
        {
          type: 'USER_POINT',
          user_point_id: '26340584-f777-404c-82c5-56220667464b',
        } as core.UserPointIdentifierInfo,
        {
          type: 'USER_ACCOUNT',
          user_account_id: '914eb2aa50cef7f3a8705b6bb54e50bb',
          creation_ts: 1493118667529,
        } as core.UserAccountIdentifierInfo,
        {
          type: 'USER_EMAIL',
          hash: 'e2749f6f4d8104ec385a75490b587c86',
          email: undefined,
          operator: undefined,
          creation_ts: 1493118667529,
          last_activity_ts: 1493127642622,
          providers: [],
        } as core.UserEmailIdentifierInfo,
        {
          type: 'USER_AGENT',
          vector_id: 'vec:886742516',
          device: {
            form_factor: 'PERSONAL_COMPUTER',
            os_family: 'MAC_OS',
            browser_family: 'CHROME',
            brand: undefined,
            model: undefined,
            os_version: undefined,
            carrier: undefined,
          },
          creation_ts: 1493118667529,
          last_activity_ts: 1493126966889,
          providers: [],
          mappings: [],
        } as core.UserAgentIdentifierInfo,
      ],
      user_profiles: [],
    };

    const batchUpdateRequest: BatchUpdateRequest<AudienceFeedBatchContext, string> = {
      batch_content: ['subBatch_1', 'subBatch_2', 'subBatch_3'],
      ts: new Date().getTime(),
      context: {
        endpoint: '/v1/user-segment-update',
        feed_id: '42',
        feed_session_id: '43',
        segment_id: '451256',
        datamart_id: '1023',
        grouping_key: '',
      },
    };

    void request(runner.plugin.app)
      .post('/v1/external_segment_creation')
      .send(externalSegmentCreation)
      .end(function (err, res) {
        expect(res.status).to.equal(200);

        expect(JSON.parse(res.text).status).to.be.eq('ok');

        void request(runner.plugin.app)
          .post('/v1/external_segment_connection')
          .send(externalSegmentConnection)
          .end(function (err, res) {
            expect(res.status).to.equal(200);

            expect(JSON.parse(res.text).status).to.be.eq('ok');

            void request(runner.plugin.app)
              .post('/v1/user_segment_update')
              .send(userSegmentUpdateRequest)
              .end(function (err, res) {
                expect(res.status).to.equal(200);
                expect(JSON.parse(res.text).data).to.deep.equal([
                  {
                    type: 'FILE_DELIVERY',
                    content: 'my_string',
                    grouping_key: 'groupingKey',
                    destination_token: 'destination_1',
                  },
                ]);
                expect(JSON.parse(res.text).status).to.be.eq('ok');
              });

            void request(runner.plugin.app)
              .post('/v1/batch_update')
              .send(batchUpdateRequest)
              .end(function (err, res) {
                expect(res.status).to.equal(500);

                expect(JSON.parse(res.text).message).to.be.eq("Plugin doesn't support batch update");

                done();
              });
          });
      });
  });

  afterEach(() => {
    // We clear the cache so that we don't have any processing still running in the background
    runner.plugin.pluginCache.clear();
  });
});
