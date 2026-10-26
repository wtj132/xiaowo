export interface Config {
  port: number;
  dataDir: string;
  password: string;
  apiToken: string;
  dshBin: string;
  dshHome: string;
  dshWorkspace: string;
  searchCmd: string[];
  tesseractLangs: string;
  trustProxy: boolean;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: Number(env.PORT ?? 8080),
    dataDir: required(env, 'DATA_DIR'),
    password: required(env, 'APP_PASSWORD'),
    apiToken: required(env, 'API_TOKEN'),
    dshBin: env.DSH_BIN ?? 'dsh',
    dshHome: env.DSH_BRIDGE_HOME ?? '.dsh',
    dshWorkspace: env.DSH_WORKSPACE ?? '.dsh/workspace',
    searchCmd: (env.SEARCH_CMD ?? 'uvx free-search-mcp').split(' ').filter(Boolean),
    tesseractLangs: env.TESSERACT_LANGS ?? 'chi_sim+eng',
    trustProxy: env.TRUST_PROXY === '1',
  };
}
