/* eslint-env jest */

import path from 'node:path';

import { runExportSideEffects } from './export-side-effects';
import { createExpoServe, executeExpoAsync } from '../../utils/expo';
import { findProjectFiles, getRouterE2ERoot } from '../utils';

runExportSideEffects();

describe('server loader (SSR)', () => {
  const projectRoot = getRouterE2ERoot();
  const outputName = 'dist-server-loader';

  beforeAll(async () => {
    await executeExpoAsync(projectRoot, ['export', '-p', 'web', '--output-dir', outputName], {
      env: {
        NODE_ENV: 'production',
        EXPO_USE_STATIC: 'server',
        E2E_ROUTER_SRC: 'server-loader',
        E2E_ROUTER_SERVER_LOADERS: 'true',
        E2E_ROUTER_SERVER_RENDERING: 'true',
        TEST_SECRET_KEY: 'test-secret-key',
      },
    });
  });

  describe('requests', () => {
    const server = createExpoServe({
      cwd: projectRoot,
      env: {
        NODE_ENV: 'production',
        TEST_SECRET_KEY: 'test-secret-key',
      },
    });

    beforeAll(async () => {
      await server.startAsync([outputName]);
    });
    afterAll(async () => {
      await server.stopAsync();
    });

    it('has expected files', async () => {
      const files = findProjectFiles(path.join(projectRoot, outputName));

      // SSR mode should have server directory with render module
      expect(files).toContain('server/_expo/server/render.js');
      expect(files).toContain('server/_expo/routes.json');

      // Loader bundles should exist
      expect(files).toContain('server/_expo/loaders/env.js');
      expect(files).toContain('server/_expo/loaders/second.js');
      expect(files).toContain('server/_expo/loaders/posts/[postId].js');

      // No pre-rendered HTML files (SSR renders at runtime)
      expect(files).not.toContain('server/index.html');
      expect(files).not.toContain('server/second.html');
    });

    it('routes.json has loader paths', async () => {
      const routesJson = require(path.join(projectRoot, outputName, 'server/_expo/routes.json'));

      // Find routes with loaders
      const envRoute = routesJson.htmlRoutes.find((r: any) => r.page === '/env');
      const secondRoute = routesJson.htmlRoutes.find((r: any) => r.page === '/second');
      const postRoute = routesJson.htmlRoutes.find((r: any) => r.page === '/posts/[postId]');
      const indexRoute = routesJson.htmlRoutes.find((r: any) => r.page === '/index');

      // Routes with loaders should have loader path
      expect(envRoute?.loader).toBe('_expo/loaders/env.js');
      expect(secondRoute?.loader).toBe('_expo/loaders/second.js');
      expect(postRoute?.loader).toBe('_expo/loaders/posts/[postId].js');

      // Route without loader should not have loader property
      expect(indexRoute?.loader).toBeUndefined();
    });

    it('SSR renders page with loader data', async () => {
      const response = await server.fetchAsync('/second');
      const html = await response.text();

      // The page should have loader data injected into the HTML
      expect(html).toContain('__EXPO_ROUTER_LOADER_DATA__');
      // The data is JSON-escaped when serialized (backslash-escaped quotes)
      expect(html).toMatch(/data.*second/);
    });

    it('SSR renders dynamic route with loader data', async () => {
      const response = await server.fetchAsync('/posts/test-post-id');
      const html = await response.text();

      // The page should have loader data with the param injected
      expect(html).toContain('__EXPO_ROUTER_LOADER_DATA__');
      expect(html).toContain('test-post-id');
    });

    it('loader endpoint returns JSON for client navigation', async () => {
      const response = await server.fetchAsync('/_expo/loaders/second');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const data = await response.json();
      expect(data).toBeDefined();
    });

    it('loader endpoint returns JSON with params for dynamic route', async () => {
      const response = await server.fetchAsync('/_expo/loaders/posts/my-test-post');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const data = await response.json();
      expect(data.params).toHaveProperty('postId', 'my-test-post');
    });
  });
});
