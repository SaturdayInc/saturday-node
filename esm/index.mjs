// The entry Node loads for `import` from an ES module. The build in dist/ is CommonJS, whose
// default import under Node's own ES modules is the module object; this gives `import Saturday
// from '@saturdayinc/sdk'` the client class there too.
import cjs from '../dist/index.js';

export const {
  Saturday,
  AIStreamError,
  SaturdayError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
  NotFoundError,
} = cjs;
export default cjs.Saturday;
