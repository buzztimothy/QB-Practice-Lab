import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { previewRuntimeGrantStatements } from '../scripts/preview-runtime-grants.js';

const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

describe('D-002A deployment boundary',()=>{
  it('allows Preview deployment only by manual dispatch of the exact reviewed main SHA',()=>{
    const workflow=read('.github/workflows/preview-deploy.yml');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/pull_request:|push:/);
    expect(workflow).toContain("github.ref == 'refs/heads/main' && inputs.main_sha == github.sha");
    expect(workflow).toContain('ref: ${{ inputs.main_sha }}');
    expect(workflow).toContain('test "$(git rev-parse FETCH_HEAD)" = "$MAIN_SHA"');
    expect(workflow).toContain('${RENDER_DEPLOY_HOOK_URL}&ref=${MAIN_SHA}');
    expect(workflow).toContain('environment: bbb-preview-deploy');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('pnpm preview:deploy-database');
    expect(workflow).toContain('PREVIEW_DATABASE_HOST: ${{ vars.PREVIEW_DATABASE_HOST }}');
    expect(workflow).toContain('$PREVIEW_ORIGIN/health/ready');
  });

  it('keeps runtime and deploy credentials separate in the Render contract',()=>{
    const render=read('render.yaml');
    expect(render).toContain('plan: starter');
    expect(render).toContain('key: NODE_VERSION');
    expect(render).toContain('value: "22.18.0"');
    expect(render).toContain('autoDeploy: false');
    expect(render).toContain('healthCheckPath: /health/ready');
    expect(render).toContain('startCommand: pnpm start:web');
    expect(render).toContain('key: LOCAL_AUTH_ENABLED');
    expect(render).toContain('value: "false"');
    expect(render).toContain('key: DATABASE_URL');
    expect(render).not.toContain('DIRECT_DATABASE_URL');
  });

  it('applies an explicit least-privilege runtime role contract after committed migrations',()=>{
    const script=read('scripts/deploy-preview-database.ts');
    expect(script).toContain("'prisma','migrate','deploy'");
    expect(script).not.toMatch(/db push|migrate dev/);
    expect(script).toContain('applyPreviewRuntimeGrants(tx)');
    expect(script).toContain('pg_try_advisory_lock(6982806162030449104)');
    expect(script).toContain('pg_advisory_unlock(6982806162030449104)');
    expect(script).not.toContain('pg_try_advisory_xact_lock');
    expect(script.indexOf('pg_try_advisory_lock')).toBeLessThan(script.indexOf("'prisma','migrate','deploy'"));
    expect(script.indexOf('pg_advisory_unlock')).toBeGreaterThan(script.lastIndexOf('bootstrap-canonical.js'));
    expect(previewRuntimeGrantStatements).toContain('REVOKE CREATE ON SCHEMA public FROM bbb_preview_runtime_lp');
    expect(previewRuntimeGrantStatements.join('\n')).not.toContain('GRANT ALL');
    expect(previewRuntimeGrantStatements.join('\n')).not.toContain('canonical_lab_bootstrap TO bbb_preview_runtime_lp');
  });

  it('pins the controlled origins and defers every external action to D-002B',()=>{
    const architecture=read('docs/architecture/D002.md');
    const runbook=read('docs/operations/D002B-PROVISIONING.md');
    expect(architecture).toContain('# D-002A Preview Repository & Authentication Foundation');
    expect(architecture).toContain('https://preview.clientpracticelabs.com');
    expect(architecture).toContain('creates no external resource, secret, DNS record, charge, or deployment');
    expect(runbook).toContain('https://app.clientpracticelabs.com');
    expect(runbook).toContain('Clerk Pro **Production** instance');
    expect(runbook).toContain('Do not add or alter apex, `app`, or unrelated records');
    expect(runbook).toContain('starts only from reviewed, merged `main`');
  });
});
