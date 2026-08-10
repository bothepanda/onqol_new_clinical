// The flat concept map, now derived from the typed registry.
//
// It used to be the source of truth, and an empty array in it meant six
// different things at once - see conceptRegistry.js for what that cost. The map
// survives only as a compatibility view for callers that just need
// `conceptId -> actionIds`; the kinds live next door.

export {
  appendicitisRouterConceptMap,
  mapRouterConceptToCaseActionIds,
} from "./conceptRegistry.js";
