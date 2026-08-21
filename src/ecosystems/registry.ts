import type { EcosystemPlugin } from '../core/types.js';
import { npmPlugin } from './npm/plugin.js';

export const ecosystemPlugins: EcosystemPlugin[] = [npmPlugin];
