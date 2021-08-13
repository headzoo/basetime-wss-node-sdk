WSS Node SDK
============
Software development kit for creating WSS plugins. WSS and plugins communicate with each other using dispatched events over HTTP or pubsub, and while that can be done without the sdk for max flexibility the sdk makes the process easier and foolproof.

* [Installing](#installing)
* [Creating a plugin with Express](#creating-a-plugin-with-express)
* [Creating a plugin with onRequest](#creating-a-plugin-with-onrequest)
* [Creating a plugin with pubsub](#creating-a-plugin-with-pubsub)
* [Creating a plugin with document triggers](#creating-a-plugin-with-document-triggers)


### Installing
Install the sdk using npm or yarn.

```
npm -i @basetime/wss-node-sdk
```
or
```
yarn add @basetime/wss-node-sdk
```

### Creating a plugin with Express
Plugins can be created using Firebase HTTP endpoints with Express middleware. The sdk middleware decodes incoming events and encodes outgoing results. The `wssMiddleware` and `wssErrorMiddleware` middleware functions are imported and wired up to express.

```typescript
import * as functions from 'firebase-functions';
import express from 'express';
import { wssMiddleware, wssErrorMiddleware } from '@basetime/wss-node-sdk';
import { PaymentEvent } from './events';

// Define the manifest which describes the plugin and the events
// it subscribes to. The subscriptions are a map of event names and
// the http endpoints that handle those events.
const manifest = {
  manifestVersion: '1.0',
  name: 'CyberSourceIntegration',
  subsystem: 'payments',
  description: 'Handles payments for the CyberSource payment processor.',
  version: '1.0',
  subscriptions: {
    'payments.PAYMENT_QUERY': '/payment-query',
  },
};

// Add the sdk middleware to express. Pass the manifest to the middleware
// function.
const app = express();
app.use(wssMiddleware(manifest));

// Logging levels can also be specified in the middleware.
//
// app.use(wssMiddleware(manifest, {
//    consoleLogLevel: Level.DEBUG,
//    remoteLogLevel: Level.INFO,
// }));

// This endpoint handles the payment.PAYMENT_QUERY event.
app.post('/payment-query', (req: express.Request) => {
  const event = req.wss.event<PaymentEvent>();
  if (event.action === 'token') {
    event.token = '123456';
    event.stopPropagation();
  } else {
    req.wss.logger.error(`Unknown "${event.action}"`);
    req.wss.dispatch(new Event('someOtherEvent'));
  }
});

// Add the sdk error handler LAST in the middleware chain.
app.use(wssErrorMiddleware());

// Register the app with Firebase.
export const cyberSourcePayment = functions.https.onRequest(app);
```

The `wssMiddleware` middleware function adds a `wss` property to the incoming request, i.e. `req.wss`. The object contains the following properties.

* `req.wss.event<T>()` - Returns an instance of `IEvent` that was dispatched to the endpoint.
* `req.wss.logger` - An instance of the sdk `Logger` class used for logging.
* `req.wss.dispatch()` - Used to dispatch events to other plugins and event handlers.
* `req.wss.attributes` - A `Record` of attributes passed to the plugin.
* `req.wss.manifest` - Instance of the plugin manifest.
* `req.wss.pluginVersion` - Version of the plugin being dispatched. Plugins should be able to handle previous versions of themselves for short periods of time to account for the upgrading process.

The `wssErrorMiddleware` captures errors which were generated during the event. The errors are logged and sent back to WSS. This middleware must be added last in the Express middleware chain.


### Creating a plugin with onRequest
Plugins can be created using Firebase HTTP endpoints. The sdk middleware decodes incoming events and encodes outgoing results. The `wssOnRequest`  function...

```typescript
import * as functions from 'firebase-functions';
import { Request } from 'express';
import { IEvent, Event, wssOnRequest } from '@basetime/wss-node-sdk';
import { PaymentEvent } from './events';

// Define the manifest which describes the plugin and the events
// it subscribes to. The subscriptions are a map of event names and
// the http endpoints that handle those events.
// The manifest is passed to the wssOnRequest middleware, which returns
// a function that will used in the https.onRequest() function.
const wssPublish = wssOnRequest({
    manifestVersion: '1.0',
    name: 'CyberSourceIntegrationHttp',
    subsystem: 'payments',
    description: '',
    version: '1.0',
    subscriptions: {
        'payment.PAYMENT_QUERY': '/cyberSourcePaymentRequest',
    },
});

// This endpoint handles the payment.PAYMENT_QUERY event.
export const cyberSourcePaymentRequest = functions.https.onRequest(wssPublish((req: Request) => {
    const event = req.wss.event<PaymentEvent>();
    if (event.action === 'token') {
        event.token = '123456';
        event.stopPropagation();
    } else {
        req.wss.logger.error(`Unknown "${event.action}"`);
        req.wss.dispatch(new Event('someOtherEvent'));
    }
}));
```

The `wssOnRequest` middleware function adds a `wss` property to the incoming request, i.e. `req.wss`. The object contains the following properties.

* `req.wss.event<T>()` - Returns an instance of `IEvent` that was dispatched to the endpoint.
* `req.wss.logger` - An instance of the sdk `Logger` class used for logging.
* `req.wss.dispatch()` - Used to dispatch events to other plugins and event handlers.
* `req.wss.attributes` - A `Record` of attributes passed to the plugin.
* `req.wss.manifest` - Instance of the plugin manifest.
* `req.wss.pluginVersion` - Version of the plugin being dispatched. Plugins should be able to handle previous versions of themselves for short periods of time to account for the upgrading process.

### Creating a plugin with pubsub
Plugins can also be created using Firebase pubsub.

```typescript
import * as functions from 'firebase-functions';
import { IEvent, Event, Wss, wssPubSub } from '@basetime/wss-node-sdk';
import { EventContext } from 'firebase-functions';
import { Message } from 'firebase-functions/lib/providers/pubsub';

// Define the manifest which describes the plugin and the events
// it subscribes to. The subscriptions are a map of event names and
// the pubsub topics that handle those events.
// The manifest is passed to the wssPubSub middleware, which returns
// a function that will used in the topic.onPublish() function.
const wssPublish = wssPubSub({
  manifestVersion: '1.0',
  name: 'CyberSourceIntegration',
  subsystem: 'payments',
  description: 'Handles payments for the CyberSource payment processor.',
  version: '1.0',
  subscriptions: {
    'payments.PAYMENT_QUERY': 'payments-cybersource',
  },
});

// Handles the payments.PAYMENT_QUERY event.
export const cyberSourcePaymentPubSub = functions.pubsub
    .topic('payments-cybersource')
    .onPublish(wssPublish((message: Message, context: EventContext, wss: Wss) => {
      interface PaymentEvent extends IEvent {
        action: string;
        token: string;
      }

      const event = wss.event<PaymentEvent>();
      if (event.action === 'token') {
        event.token = '123456';
        event.stopPropagation();
      } else {
        wss.logger.error(`Unknown action "${event.action}"`);
        wss.dispatch(new Event('someOtherEvent'));
      }
    }));
```
The `onPublish` callback receives the standard `Message` and `EventContext` parameters along with an instance of `Wss` which contains the following properties.

* `wss.event<T>()` - Returns an instance of `IEvent` that was dispatched to the endpoint.
* `wss.logger` - An instance of the sdk `Logger` class used for logging.
* `wss.dispatch()` - Used to dispatch events to other plugins and event handlers.
* `wss.attributes` - A `Record` of attributes passed to the plugin.
* `wss.manifest` - Instance of the plugin manifest.
* `wss.pluginVersion` - Version of the plugin being dispatched. Plugins should be able to handle previous versions of themselves for short periods of time to account for the upgrading process.

### Creating a plugin with document triggers
Coming soon...
