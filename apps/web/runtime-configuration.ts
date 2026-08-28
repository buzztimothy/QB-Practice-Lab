import { canonicalLabVersion } from '../student/persistence.js';

export interface ProductionRuntimeConfiguration {
  readonly production: true;
  readonly databaseUrl: string;
  readonly appOrigin: string;
  readonly clerk: {
    readonly secretKey: string;
    readonly publishableKey: string;
    readonly jwtKey: string;
    readonly issuer: string;
    readonly audience: string;
    readonly authorizedParty: string;
    readonly signInUrl: string;
    readonly webhookSigningSecret: string;
  };
  readonly sessionTtlSeconds: number;
  readonly canonicalLabVersion: string;
}

const required = (env: NodeJS.ProcessEnv, name: string) => {
  const value=env[name]?.trim();
  if(!value)throw new Error(`Production configuration requires ${name}`);
  return value;
};

export function productionRuntimeConfiguration(env:NodeJS.ProcessEnv):ProductionRuntimeConfiguration {
  if(env.NODE_ENV!=='production')throw new Error('Preview requires NODE_ENV=production');
  if(env.DURABLE_RUNTIME_ENABLED!=='true')throw new Error('Preview requires durable runtime');
  if(env.LOCAL_AUTH_ENABLED!==undefined&&env.LOCAL_AUTH_ENABLED!=='false')throw new Error('Preview prohibits local authentication');
  const appOrigin=required(env,'APP_ORIGIN');
  const origin=new URL(appOrigin);
  if(origin.protocol!=='https:'||origin.origin!==appOrigin||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('APP_ORIGIN must be an exact HTTPS origin');
  const ttl=Number(required(env,'SESSION_TTL_SECONDS'));
  if(!Number.isInteger(ttl)||ttl<300||ttl>28_800)throw new Error('SESSION_TTL_SECONDS is outside Preview policy');
  const expectedVersion=required(env,'CANONICAL_LAB_VERSION');
  if(expectedVersion!==canonicalLabVersion)throw new Error('Canonical Lab version is incompatible');
  const authorizedParty=required(env,'CLERK_AUTHORIZED_PARTY');
  if(authorizedParty!==appOrigin)throw new Error('Clerk authorized party must equal APP_ORIGIN');
  const issuer=required(env,'CLERK_ISSUER');
  if(new URL(issuer).protocol!=='https:')throw new Error('Clerk issuer must use HTTPS');
  const databaseUrl=required(env,'DATABASE_URL'),database=new URL(databaseUrl);
  if(database.protocol!=='postgresql:'||database.searchParams.get('sslmode')!=='require')throw new Error('Preview database must use PostgreSQL with required TLS');
  const signInUrl=required(env,'CLERK_SIGN_IN_URL');
  if(new URL(signInUrl).protocol!=='https:')throw new Error('Clerk sign-in URL must use HTTPS');
  return Object.freeze({production:true,databaseUrl,appOrigin,clerk:Object.freeze({secretKey:required(env,'CLERK_SECRET_KEY'),publishableKey:required(env,'CLERK_PUBLISHABLE_KEY'),jwtKey:required(env,'CLERK_JWT_KEY'),issuer,audience:required(env,'CLERK_AUDIENCE'),authorizedParty,signInUrl,webhookSigningSecret:required(env,'CLERK_WEBHOOK_SIGNING_SECRET')}),sessionTtlSeconds:ttl,canonicalLabVersion:expectedVersion});
}
