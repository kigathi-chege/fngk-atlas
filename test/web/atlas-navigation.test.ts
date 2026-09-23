import {describe,expect,it} from 'vitest';
import {createAtlasNavigation,parseAtlasLocation,serializeAtlasLocation} from '../../src/web/lib/atlas-navigation.js';

describe('semantic Atlas navigation',()=>{
 it('enters, moves up, switches views, and returns home without mixing panel state',()=>{const nav=createAtlasNavigation({contextId:'device:one',view:'overview',level:0});nav.enter('workload');nav.enter('module');expect(nav.snapshot().rootId).toBe('module');nav.up();expect(nav.snapshot().rootId).toBe('workload');nav.openView('runtime');expect(nav.snapshot()).toMatchObject({rootId:'workload',view:'runtime',level:0});nav.home();expect(nav.snapshot()).toEqual({contextId:'device:one',view:'overview',level:0})});
 it('round-trips deep links and tolerates malformed values',()=>{const value={contextId:'device:one',rootId:'world:one',view:'software' as const,level:3,focusId:'symbol'};expect(parseAtlasLocation(serializeAtlasLocation(value))).toEqual(value);expect(parseAtlasLocation('?contextId=local&atlasView=bogus&atlasLevel=99')).toEqual({contextId:'local',rootId:undefined,view:'overview',level:4,focusId:undefined})});
 it('uses the canonical breadcrumb parent when opening a deep link directly',()=>{const nav=createAtlasNavigation({contextId:'device:one',rootId:'module',view:'software',level:2});nav.up('workload');expect(nav.snapshot()).toMatchObject({rootId:'workload',view:'software',level:0})});
});
