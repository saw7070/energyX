import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect} from 'vitest';
import {createMetadataStore} from './index.js';
it('completes data-only publication only for the exact candidate and never discards an Overview receipt',()=>{
 const root=mkdtempSync(join(tmpdir(),'readings-publication-'));
 const store=createMetadataStore({database_path:join(root,'metadata.sqlite')});
 try {
  store.users.upsertDevUser({id:'u',email:'u@example.test',display_name:'u',dev_token:'u'});
  store.workspaces.upsert({id:'w',name:'w',owner_user_id:'u',kind:'customer'});
  const initial=store.energyIq.upsertProject({id:'p',workspace_id:'w',name:'p',status:'draft'});
  store.db.prepare("INSERT OR IGNORE INTO energyiq_data_snapshots (id,workspace_id,project_id,manifest_json,audit_json,created_at) VALUES (?, 'w', 'p', '{}', '{}', '2026-09-12')").run(initial.data_snapshot_id);
  store.energyIq.beginProjectDataPublication({project_id:'p',expected_previous_snapshot_id:initial.data_snapshot_id});
  store.energyIq.markProjectDataPublicationCandidate({project_id:'p',expected_previous_snapshot_id:initial.data_snapshot_id,candidate_snapshot_id:initial.data_snapshot_id});
  expect(()=>store.energyIq.completeProjectReadingsPublication({project_id:'p',expected_previous_snapshot_id:'wrong',candidate_snapshot_id:initial.data_snapshot_id})).toThrow('PUBLICATION_STALE');
  expect(store.energyIq.findProjectDataPublication('p')).toBeDefined();
  store.energyIq.completeProjectReadingsPublication({project_id:'p',expected_previous_snapshot_id:initial.data_snapshot_id,candidate_snapshot_id:initial.data_snapshot_id});
  expect(store.energyIq.findProjectDataPublication('p')).toBeUndefined();
  store.energyIq.beginProjectDataPublication({project_id:'p',expected_previous_snapshot_id:initial.data_snapshot_id});
  store.energyIq.markProjectDataPublicationCandidate({project_id:'p',expected_previous_snapshot_id:initial.data_snapshot_id,candidate_snapshot_id:initial.data_snapshot_id});
  store.energyIq.markProjectOverviewPublicationCandidate({project_id:'p',expected_previous_snapshot_id:initial.data_snapshot_id,candidate_snapshot_id:initial.data_snapshot_id,overview_persistent_directory:root,overview_pointer_key:'pointer',previous_overview_projection_key:null,candidate_overview_projection_key:'view'});
  expect(()=>store.energyIq.completeProjectReadingsPublication({project_id:'p',expected_previous_snapshot_id:initial.data_snapshot_id,candidate_snapshot_id:initial.data_snapshot_id})).toThrow('PUBLICATION_STALE');
  expect(store.energyIq.findProjectDataPublication('p')).toBeDefined();
 } finally {store.close();rmSync(root,{recursive:true,force:true});}
});
