// The demo data's removal marker, kept in its own module ON PURPOSE.
//
// unseed-demo.ts needs this id, and seed-demo.ts calls main() at module
// scope. Importing the constant from there therefore STARTS THE SEEDER as a
// side effect, racing the unseeder against its own "already seeded?" guard —
// on a slow enough delete, the unseed would finish and the seeder would then
// happily reseed the rows it just removed. A constant with no side effects
// can be shared safely; a script that runs on import cannot.
export const DEMO_AIJOB_ID = "demo-seed-job";
