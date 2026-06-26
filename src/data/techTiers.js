export const techTierDefinitions = [
  {
    tier: 1,
    displayName: "Tech Tier 1",
    cost: 0,
    upgradeTime: 0
  },
  {
    tier: 2,
    displayName: "Tech Tier 2",
    cost: 260,
    upgradeTime: 28
  },
  {
    tier: 3,
    displayName: "Tech Tier 3",
    cost: 540,
    upgradeTime: 42
  }
];

export const techTiersByTier = Object.fromEntries(
  techTierDefinitions.map((definition) => [definition.tier, definition])
);
