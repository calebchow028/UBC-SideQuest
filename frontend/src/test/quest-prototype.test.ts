import { describe, expect, it } from "vitest";
import { questPrototype } from "@/lib/quest-prototype";

describe("Manual quest prototype", () => {
  it("has one queued player", () => {
    expect(questPrototype.queuedPlayers).toBe(1);
  });
  it("assigns the requested skating activity", () => {
    expect(questPrototype.assignment).toBe("Go to the ice skating rink and learn to pirouette");
  });
  it("progresses from queue to assigned quest to map", () => {
    expect([questPrototype.queuePath, questPrototype.assignmentPath, questPrototype.mapPath]).toEqual(["/queue", "/quest", "/map"]);
  });
});