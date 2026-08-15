import { createServer } from 'node:http';
createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end('<main><h1>QB Practice Lab</h1><p>P-000 architecture foundation</p></main>'); }).listen(Number(process.env.WEB_PORT ?? 3000));
