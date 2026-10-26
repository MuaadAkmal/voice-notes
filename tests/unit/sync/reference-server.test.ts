import { runContract } from './contract';
import { ReferenceServer } from './reference-server';

runContract('server rules in memory', async () => new ReferenceServer());
