/**
 * Canonical category definitions.
 * These must match the normalize_category() function in the database.
 * The DB trigger auto-normalizes on insert/update, so the AI can return
 * any variant and it will be mapped to one of these canonical values.
 */

// Map from DB value → display label
export const categoryDisplayMap: Record<string, string> = {
  groceries: "Groceries",
  task: "Task",
  home_improvement: "Home Improvement",
  travel: "Travel",
  date_ideas: "Date Ideas",
  shopping: "Shopping",
  health: "Health",
  finance: "Finance",
  work: "Work",
  personal: "Personal",
  gift_ideas: "Gift Ideas",
  recipes: "Recipes",
  entertainment: "Entertainment",
  books: "Books",
  pet_care: "Pet Care",
  reminder: "Reminder",
  wines: "Wines",
  automotive: "Automotive",
  technology: "Technology",
  business: "Business",
  parenting: "Parenting",
  home_hunting: "Home Hunting",
  app_feedback: "App Feedback",
};

// Display labels for UI dropdowns (legacy export, maintains compatibility)
export const categories = Object.values(categoryDisplayMap);

export const defaultCategories = [
  "Groceries",
  "Task",
  "Home Improvement",
  "Travel",
  "Date Ideas",
];

/**
 * Convert a display label back to DB canonical value.
 * Used when the UI needs to filter/query by category.
 */
export function categoryToDbValue(displayLabel: string): string {
  const entry = Object.entries(categoryDisplayMap).find(
    ([, label]) => label === displayLabel
  );
  return entry ? entry[0] : displayLabel.toLowerCase().replace(/\s+/g, "_");
}

/**
 * Convert a DB canonical value to display label.
 */
export function dbValueToCategory(dbValue: string): string {
  return categoryDisplayMap[dbValue] || dbValue.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}
