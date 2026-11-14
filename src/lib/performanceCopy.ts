/** Display wording only. Outcome codes and calculations remain unchanged. */
export function resultLabel(outcome: string): string {
  return (
    (
      {
        WON: "Won",
        LOST: "Lost",
        VOID: "Void",
        PENDING: "Pending",
        OTHER: "Other results",
      } as Record<string, string>
    )[outcome] ?? "Needs review"
  );
}
