// NBA franchise table for the 2023-24 season: stats.nba.com team ids, tricodes and the conference/division
// alignment the opponent tokens (`opp.div:pacific`, `opp.conf:west`) resolve against.

export type Conference = "east" | "west";
export type Division = "atlantic" | "central" | "southeast" | "northwest" | "pacific" | "southwest";

export interface Team {
  id: number;
  tri: string;
  city: string;
  name: string;
  conf: Conference;
  div: Division;
}

const T = (id: number, tri: string, city: string, name: string, conf: Conference, div: Division): Team => ({
  id: 1610612700 + id,
  tri,
  city,
  name,
  conf,
  div,
});

export const TEAMS: readonly Team[] = [
  T(37, "ATL", "Atlanta", "Hawks", "east", "southeast"),
  T(38, "BOS", "Boston", "Celtics", "east", "atlantic"),
  T(39, "CLE", "Cleveland", "Cavaliers", "east", "central"),
  T(40, "NOP", "New Orleans", "Pelicans", "west", "southwest"),
  T(41, "CHI", "Chicago", "Bulls", "east", "central"),
  T(42, "DAL", "Dallas", "Mavericks", "west", "southwest"),
  T(43, "DEN", "Denver", "Nuggets", "west", "northwest"),
  T(44, "GSW", "Golden State", "Warriors", "west", "pacific"),
  T(45, "HOU", "Houston", "Rockets", "west", "southwest"),
  T(46, "LAC", "LA", "Clippers", "west", "pacific"),
  T(47, "LAL", "Los Angeles", "Lakers", "west", "pacific"),
  T(48, "MIA", "Miami", "Heat", "east", "southeast"),
  T(49, "MIL", "Milwaukee", "Bucks", "east", "central"),
  T(50, "MIN", "Minnesota", "Timberwolves", "west", "northwest"),
  T(51, "BKN", "Brooklyn", "Nets", "east", "atlantic"),
  T(52, "NYK", "New York", "Knicks", "east", "atlantic"),
  T(53, "ORL", "Orlando", "Magic", "east", "southeast"),
  T(54, "IND", "Indiana", "Pacers", "east", "central"),
  T(55, "PHI", "Philadelphia", "76ers", "east", "atlantic"),
  T(56, "PHX", "Phoenix", "Suns", "west", "pacific"),
  T(57, "POR", "Portland", "Trail Blazers", "west", "northwest"),
  T(58, "SAC", "Sacramento", "Kings", "west", "pacific"),
  T(59, "SAS", "San Antonio", "Spurs", "west", "southwest"),
  T(60, "OKC", "Oklahoma City", "Thunder", "west", "northwest"),
  T(61, "TOR", "Toronto", "Raptors", "east", "atlantic"),
  T(62, "UTA", "Utah", "Jazz", "west", "northwest"),
  T(63, "MEM", "Memphis", "Grizzlies", "west", "southwest"),
  T(64, "WAS", "Washington", "Wizards", "east", "southeast"),
  T(65, "DET", "Detroit", "Pistons", "east", "central"),
  T(66, "CHA", "Charlotte", "Hornets", "east", "southeast"),
];

export const TEAM_BY_ID = new Map(TEAMS.map((t) => [t.id, t]));
export const TEAM_BY_TRI = new Map(TEAMS.map((t) => [t.tri, t]));

export const DIVISIONS: readonly Division[] = ["atlantic", "central", "southeast", "northwest", "pacific", "southwest"];
export const CONFERENCES: readonly Conference[] = ["east", "west"];
