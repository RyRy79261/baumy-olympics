// PROTOTYPE (issue #7), throwaway. Sample data for the portrait kitchen
// dashboard mockups (iPad portrait, 820×1180). Names other than Ryan are
// stand-ins until the owner gives the real housemates.

export type Taxonomy = "consumables" | "maintenance";

export const HOUSEMATES = [
  { id: "ryan", name: "Ryan", color: "#4ff5e6", points: 1240, streak: 6, hair: "#3b2a1a", shirt: "#4ff5e6" },
  { id: "jo", name: "Jo", color: "#ff8fc7", points: 1185, streak: 4, hair: "#c2410c", shirt: "#ff8fc7" },
  { id: "sam", name: "Sam", color: "#ffe46b", points: 960, streak: 2, hair: "#111111", shirt: "#ffe46b" },
  { id: "mika", name: "Mika", color: "#8f7dff", points: 870, streak: 0, hair: "#e5e7eb", shirt: "#8f7dff" },
] as const;

export type Bounty = {
  id: string;
  title: string;
  taxonomy: Taxonomy;
  reward: number;
  /** Hours until the deadline; negative is overdue. */
  dueInHours: number;
  isNew: boolean;
  /** Who holds the streak on it (steal it for a bonus), if anyone. */
  streak: { who: string; n: number } | null;
  icon: string; // a key the variant maps to its own pixel icon
};

export const BOUNTIES: Bounty[] = [
  { id: "b1", title: "Toilet paper", taxonomy: "consumables", reward: 15, dueInHours: -3, isNew: false, streak: null, icon: "tp" },
  { id: "b2", title: "Cat food", taxonomy: "consumables", reward: 20, dueInHours: 5, isNew: true, streak: { who: "jo", n: 3 }, icon: "catfood" },
  { id: "b3", title: "Dish soap", taxonomy: "consumables", reward: 10, dueInHours: 30, isNew: true, streak: null, icon: "soap" },
  { id: "b4", title: "Coffee beans", taxonomy: "consumables", reward: 10, dueInHours: 48, isNew: false, streak: { who: "ryan", n: 2 }, icon: "coffee" },
  { id: "b5", title: "Bins out", taxonomy: "maintenance", reward: 20, dueInHours: 2, isNew: false, streak: { who: "ryan", n: 6 }, icon: "bin" },
  { id: "b6", title: "Litter box", taxonomy: "maintenance", reward: 25, dueInHours: -20, isNew: false, streak: null, icon: "litter" },
  { id: "b7", title: "Descale kettle", taxonomy: "maintenance", reward: 30, dueInHours: 70, isNew: true, streak: null, icon: "kettle" },
  { id: "b8", title: "Fridge clean-out", taxonomy: "maintenance", reward: 55, dueInHours: 20, isNew: false, streak: { who: "sam", n: 1 }, icon: "fridge" },
  { id: "b9", title: "Vacuum lounge", taxonomy: "maintenance", reward: 30, dueInHours: 26, isNew: false, streak: { who: "jo", n: 4 }, icon: "vacuum" },
  { id: "b10", title: "Water plants", taxonomy: "maintenance", reward: 15, dueInHours: 8, isNew: false, streak: { who: "mika", n: 1 }, icon: "plant" },
];

/** Urgent = overdue or due within 12 hours. */
export const isUrgent = (b: Bounty) => b.dueInHours <= 12;

export const POT = { euros: 124.5, season: 2026, daysLeft: 95 };

/** Today is Monday 28 Sep 2026. day 0 = Monday. */
export const WEEK = [
  { day: 0, start: "07:30", end: "08:00", title: "Recycling pickup", who: "house" },
  { day: 0, start: "18:00", end: "20:00", title: "Climbing", who: "ryan" },
  { day: 0, start: "19:30", end: "22:00", title: "Dinner: Jo's friends", who: "jo" },
  { day: 1, start: "09:00", end: "10:00", title: "Vet: Baumy jabs", who: "house" },
  { day: 1, start: "20:00", end: "23:00", title: "Board games", who: "house" },
  { day: 2, start: "10:00", end: "16:00", title: "Handyman (boiler)", who: "house" },
  { day: 2, start: "18:30", end: "19:30", title: "Yoga", who: "mika" },
  { day: 3, start: "12:00", end: "13:00", title: "Lunch w/ mum", who: "sam" },
  { day: 4, start: "19:00", end: "23:59", title: "Kiez party", who: "house" },
  { day: 5, start: "10:00", end: "12:00", title: "Flea market", who: "jo" },
  { day: 5, start: "14:00", end: "18:00", title: "Keller clear-out", who: "house" },
  { day: 6, start: "11:00", end: "14:00", title: "Brunch", who: "house" },
];

export const MESSAGES = [
  { who: "jo", text: "Who ate my leftover pasta 😤", ago: "12m" },
  { who: "sam", text: "Parcel for Mika is on the shoe rack", ago: "1h" },
  { who: "ryan", text: "Boiler guy Wed 10-16, someone be home pls", ago: "3h" },
];

export const REMINDER = {
  title: "Handyman on Wednesday",
  body: "The boiler man comes Wed 10:00–16:00. Someone must be home. Tap your face when you've read this.",
  seenBy: ["ryan"],
};

export const LAST_EVENT = { text: "Jo broke Ryan's 3× vacuum streak!", bonus: 18 };

export const METRICS = {
  doneThisWeek: 23,
  houseStreakDays: 11,
  overdue: BOUNTIES.filter((b) => b.dueInHours < 0).length,
};
