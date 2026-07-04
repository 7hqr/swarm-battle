export const techTierDefinitions = [
  {
    tier: 1,
    displayName: "Tech Center Lv. 1",
    cost: 0,
    upgradeTime: 0
  },
  {
    tier: 2,
    displayName: "Tech Center Lv. 2",
    cost: 260,
    upgradeTime: 28
  },
  {
    tier: 3,
    displayName: "Tech Center Lv. 3",
    cost: 540,
    upgradeTime: 42
  },
  {
    tier: 4,
    displayName: "Tech Center Lv. 4",
    cost: 860,
    upgradeTime: 54
  }
];

export const techTiersByTier = Object.fromEntries(
  techTierDefinitions.map((definition) => [definition.tier, definition])
);
