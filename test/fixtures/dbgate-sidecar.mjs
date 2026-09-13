#!/usr/bin/env node
import {createServer} from 'node:http';
const port=Number(process.env.PORT),root=process.env.WEB_ROOT??'/';
createServer((request,response)=>{response.setHeader('content-type','text/html');response.end(`<!doctype html><title>DbGate fixture</title><main data-root="${root}">Database workbench</main>`)}).listen(port,'127.0.0.1');
