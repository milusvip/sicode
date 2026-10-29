// workerd has no library directory to load wasm artifacts from. `RepoMapParse` treats an empty
// runtime path as "unavailable" and the map is simply omitted, so module load stays side-effect
// free here instead of failing at import time.
export const repoMapWasm = { runtime: "", languages: {} as Record<string, string> }
