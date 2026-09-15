import assert from "node:assert/strict";
import { inQuietHours, localDayStartUtc, materialChangeKey, materialSnapshot, preferenceAllows } from "../src/lib/notifications";
import { safeNotificationLink } from "../src/lib/notificationLinks";

const p={market:"1X2",pick:"Home",odds:1.8,kickoff:new Date("2026-09-14T12:00:00Z"),status:"PUBLISHED"};
assert.deepEqual(materialSnapshot(p),{market:"1X2",pick:"Home",odds:1.8,kickoff:"2026-09-14T12:00:00.000Z",status:"PUBLISHED"});
assert.equal(materialChangeKey("p1",p,{...p,pick:"Away"}),materialChangeKey("p1",p,{...p,pick:"Away"}),"material event keys are deterministic");
assert.equal(safeNotificationLink("https://evil.example"),"/notifications");
assert.equal(safeNotificationLink("//evil.example"),"/notifications");
assert.equal(safeNotificationLink("/predictions/match/a"),"/predictions/match/a");
const lagosNight=new Date("2026-09-14T22:30:00Z");
assert.equal(inQuietHours(lagosNight,"Africa/Lagos",22*60,7*60),true,"overnight quiet hours wrap midnight");
assert.equal(preferenceAllows("RESULT_WON",{results:false}),false);
assert.equal(localDayStartUtc(new Date("2026-09-14T23:30:00Z"),"Africa/Lagos").toISOString(),"2026-09-14T23:00:00.000Z","daily cap resets at Lagos midnight");
console.log("notification policy checks passed");
