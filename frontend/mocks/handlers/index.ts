/**
 * Combined MSW handler list. Add future mock modules here and the
 * browser/server entry points pick them up automatically.
 */
import { procurementHandlers } from './procurement';

export const handlers = [...procurementHandlers];
