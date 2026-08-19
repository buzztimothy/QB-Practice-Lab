import { createServer } from 'node:http';
createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ service: 'qb-practice-lab-api', status: 'ok' })); }).listen(Number(process.env.PORT ?? 3001));
