const LIFECYCLE_STAGES = Object.freeze([
  'created',
  'analysis',
  'review',
  'approval',
  'reconciliation',
  'plan',
  'execution',
  'report',
]);

const STAGE_PROJECTION = Object.freeze([
  ['Target validation', 'created'],
  ['Website analysis', 'analysis'],
  ['Page test plan generation', 'analysis'],
  ['Interaction discovery', 'review'],
  ['Interaction approval validation', 'approval'],
  ['Interaction reconciliation', 'reconciliation'],
  ['Interaction plan generation', 'plan'],
  ['Interaction spec rendering', 'plan'],
  ['Playwright execution', 'execution'],
  ['Interaction execution', 'execution'],
  ['Report preparation', 'report'],
]);

function projectLifecycleStage(controllerStage) {
  return STAGE_PROJECTION.find(([name]) => name === controllerStage)?.[1] || null;
}

module.exports = {
  LIFECYCLE_STAGES,
  STAGE_PROJECTION,
  projectLifecycleStage,
};
