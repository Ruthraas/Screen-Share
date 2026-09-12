export type Route = "login" | "empty" | "home" | "share" | "multi" | "settings" | "profile";
export type User = { id: string; name: string; email?: string; initials: string; online: boolean; sharing?: boolean; current?: boolean; photoURL?: string };
export type Group = { id: string; name: string; members: User[]; activeStreams: number };
export type Preferences = { theme: "dark" | "light"; notifications: boolean };
export type LocalProfile = { bio: string; photoURL?: string; name?: string };
