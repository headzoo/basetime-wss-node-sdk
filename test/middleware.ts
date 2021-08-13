import { expect } from 'chai';
import { createWssFromRequest, wssMiddleware, WssMiddlewareArgs } from '../src/middleware';
import {
  IEvent,
  Level,
  Logger,
  HeaderWssAttrib,
  HeaderWssVersion,
  JsonEventKey,
  JsonPluginVersion,
  HeaderWssEvent,
} from '../src';

const manifest = {
  manifestVersion: '1.0',
  name: 'CyberSourceIntegrationHttp',
  subsystem: 'payments',
  description: '',
  version: '1.0',
  subscriptions: {
    'payment.PAYMENT_QUERY': '/payment-query',
  },
};

const body = {
  [JsonEventKey]: {
    action: 'token'
  } as PaymentEvent,
  [JsonPluginVersion]: '1.0',
};
const headers = {
  [HeaderWssEvent]: '1234',
  [HeaderWssVersion]: '1.0',
  [`${HeaderWssAttrib.toLowerCase()}-foo`]: 'foo:bar',
  [`${HeaderWssAttrib.toLowerCase()}-bar`]: 'bar:foo',
};
const args: WssMiddlewareArgs = {
  consoleLogLevel: Level.OFF,
  remoteLogLevel: Level.OFF,
}

interface PaymentEvent extends IEvent {
  action: string;
}

describe('middleware', () => {
  describe('#createWssFromRequest', () => {
    it('works correctly', () => {
      const wss = createWssFromRequest(body, headers, manifest, args);
      expect(typeof wss).to.equal('object');
      expect(wss.logger).to.be.instanceof(Logger);
      expect(wss.event<PaymentEvent>().action).to.equal('token');
      expect(wss.attributes.foo).to.equal('bar');
      expect(wss.attributes.bar).to.equal('foo');
      expect(wss.pluginVersion).to.equal('1.0');
    });
  });

  describe('#wssMiddleware', () => {
    let req;
    let res;
    let next;
    let responseNext = false;
    let responseJson = null;
    let responseHeaders = {};

    beforeEach(() => {
      req = {
        body,
        headers,
        header: (name) => {
          return headers[name];
        }
      }
      res = {
        headers,
        headersSent: false,
        header: (name, value) => {
          responseHeaders[name] = value;
        },
        json: (data) => {
          responseJson = data;
        },
      };
      next = () => {
        responseNext = true;
      };
    });

    it('works correctly', async () => {
      const app = wssMiddleware(manifest);
      await app(req, res, next);
      expect(typeof req.wss).to.equal('object');
      expect(responseNext).to.equal(true);
      expect(responseHeaders[HeaderWssEvent]).to.equal('1234');
      expect(responseHeaders[HeaderWssVersion]).to.equal('1.0');
      expect(responseJson[JsonEventKey].action).to.equal('token');
    });
  });
});
