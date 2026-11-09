// A tiny fake website + back end for the wait-engine tests. It lives on a made-up origin and is served
// through page.route(), so the tests need no network, no real site and no local server, and every delay is
// fixed (so a wait that works here is working because of the engine, not because of luck).
//
//   pages  https://wait-fixture.test/<name>.html   -> data/wait-fixture/<name>.html
//   api    /api/dashboard/:widget                  slow widget data
//          /api/countries/:code/states             dependent dropdown 1
//          /api/states/:id/cities                  dependent dropdown 2
//          POST /api/orders, GET /api/orders/:id   an order that moves through stages over time

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../../utils/global/paths');

const ORIGIN = 'https://wait-fixture.test';
const FIXTURE_DIR = path.join(DATA_DIR, 'wait-fixture');

const DASHBOARD = {
  revenue: { delay: 400, value: '$48,200' },
  orders: { delay: 900, value: '312' },
  users: { delay: 1300, value: '1,874' },
};

const STATES = {
  US: [
    { id: 'california', name: 'California' },
    { id: 'texas', name: 'Texas' },
  ],
  CA: [
    { id: 'ontario', name: 'Ontario' },
    { id: 'quebec', name: 'Quebec' },
  ],
  MY: [
    { id: 'selangor', name: 'Selangor' },
    { id: 'johor', name: 'Johor' },
  ],
};
const CITIES = {
  california: ['Los Angeles', 'San Francisco'],
  texas: ['Austin', 'Houston'],
  ontario: ['Toronto', 'Ottawa'],
  quebec: ['Montreal', 'Quebec City'],
  selangor: ['Shah Alam', 'Petaling Jaya'],
  johor: ['Johor Bahru', 'Iskandar Puteri'],
};
const STATES_DELAY = 600;
const CITIES_DELAY = 500;

// Milliseconds after the order was placed at which each status is reached
const ORDER_STAGES = [
  ['PENDING', 0],
  ['PAYMENT_CONFIRMED', 800],
  ['PACKED', 1600],
  ['SHIPPED', 2400],
];

const installed = new WeakSet();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function orderStatus(order) {
  const age = Date.now() - order.createdAt;
  if (order.scenario === 'decline') return age >= 800 ? 'PAYMENT_FAILED' : 'PENDING';

  let status = 'PENDING';
  for (const [name, reachedAt] of ORDER_STAGES) {
    if (age >= reachedAt) status = name;
  }
  return order.scenario === 'stall' && status === 'SHIPPED' ? 'PACKED' : status;
}

/**
 * Makes https://wait-fixture.test/ answer for this page. Safe to call more than once per page.
 * @param {import('@playwright/test').Page} page
 */
async function installWaitFixtureServer(page) {
  if (installed.has(page)) return;
  installed.add(page);

  const orders = new Map();
  const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(`${ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const segments = url.pathname.split('/').filter(Boolean);

    if (url.pathname.endsWith('.html')) {
      const file = path.join(FIXTURE_DIR, path.basename(url.pathname));
      return fs.existsSync(file)
        ? route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(file, 'utf-8') })
        : route.fulfill({ status: 404, body: 'not found' });
    }

    if (segments[1] === 'dashboard' && DASHBOARD[segments[2]]) {
      await sleep(DASHBOARD[segments[2]].delay);
      return json(route, { value: DASHBOARD[segments[2]].value });
    }

    if (segments[1] === 'countries' && segments[3] === 'states') {
      if (url.searchParams.get('broken') === 'states') return route.abort('failed');
      await sleep(STATES_DELAY);
      return json(route, STATES[segments[2]] ?? []);
    }

    if (segments[1] === 'states' && segments[3] === 'cities') {
      await sleep(CITIES_DELAY);
      return json(
        route,
        (CITIES[segments[2]] ?? []).map((name) => ({ id: name.toLowerCase(), name }))
      );
    }

    if (segments[1] === 'orders') {
      if (request.method() === 'POST') {
        const { scenario } = JSON.parse(request.postData() || '{}');
        const id = `ORD-${1000 + orders.size + 1}`;
        orders.set(id, { createdAt: Date.now(), scenario });
        await sleep(150);
        return json(route, { id }, 201);
      }
      const order = orders.get(segments[2]);
      if (!order) return json(route, { error: 'unknown order' }, 404);
      const status = orderStatus(order);
      return json(route, { status, trackingNumber: status === 'SHIPPED' ? `TRK-${segments[2].slice(4)}` : null });
    }

    return route.fulfill({ status: 404, body: 'not found' });
  });
}

module.exports = { installWaitFixtureServer, WAIT_FIXTURE_ORIGIN: ORIGIN };
