export const difficultyDefinitions = [
  {
    id: "easy",
    displayName: "Easy",
    aiResourceMultiplier: 0.85
  },
  {
    id: "normal",
    displayName: "Normal",
    aiResourceMultiplier: 1
  },
  {
    id: "hard",
    displayName: "Hard",
    aiResourceMultiplier: 1.2
  }
];

export const difficultiesById = Object.fromEntries(
  difficultyDefinitions.map((definition) => [definition.id, definition])
);

export const defaultDifficultyId = "normal";
