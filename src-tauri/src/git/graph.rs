//! Lane assignment for the commit graph. Pure function, no git access.
//!
//! Commits arrive newest first (children before parents). Each row records
//! what must be drawn inside it, so the UI can render any row on its own:
//!   - `top`:     lanes arriving from above that end at this commit's node
//!   - `through`: lanes passing straight through
//!   - `bottom`:  lanes leaving the node downwards, one per parent
//! Lanes never shift sideways, and a lane is reused as soon as it is free,
//! which keeps the graph narrow.

use serde::Serialize;

/// (lane index, colour index)
pub type Seg = (u16, u16);

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub struct GraphRow {
    pub lane: u16,
    pub color: u16,
    pub top: Vec<Seg>,
    pub through: Vec<Seg>,
    pub bottom: Vec<Seg>,
}

struct Lane {
    want: String,
    color: u16,
    /// False only for the lane reserved for HEAD before HEAD has been reached.
    started: bool,
}

fn free_lane(lanes: &mut Vec<Option<Lane>>, skip: Option<usize>) -> usize {
    for (i, lane) in lanes.iter().enumerate() {
        if lane.is_none() && Some(i) != skip {
            return i;
        }
    }
    lanes.push(None);
    if Some(lanes.len() - 1) == skip {
        lanes.push(None);
    }
    lanes.len() - 1
}

/// `commits` is `(id, parents)` in display order. `head` pins that commit's
/// first-parent line to lane 0.
pub fn layout(commits: &[(&str, Vec<&str>)], head: Option<&str>) -> Vec<GraphRow> {
    let mut lanes: Vec<Option<Lane>> = Vec::new();
    let mut next_color: u16 = 0;
    let mut new_color = || {
        let c = next_color;
        next_color = next_color.wrapping_add(1);
        c
    };

    if let Some(h) = head {
        if commits.iter().any(|(id, _)| *id == h) {
            lanes.push(Some(Lane {
                want: h.to_string(),
                color: new_color(),
                started: false,
            }));
        }
    }

    let mut rows = Vec::with_capacity(commits.len());
    for (id, parents) in commits {
        let mine: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter(|(_, l)| l.as_ref().is_some_and(|l| l.want == *id))
            .map(|(i, _)| i)
            .collect();

        let mut top = Vec::new();
        let (lane, color) = if let Some(&first) = mine.first() {
            let color = lanes[first].as_ref().unwrap().color;
            for &i in &mine {
                let l = lanes[i].take().unwrap();
                if l.started {
                    top.push((i as u16, l.color));
                }
            }
            (first, color)
        } else {
            (free_lane(&mut lanes, None), new_color())
        };

        let through: Vec<Seg> = lanes
            .iter()
            .enumerate()
            .filter_map(|(i, l)| match l {
                Some(l) if l.started => Some((i as u16, l.color)),
                _ => None,
            })
            .collect();

        let mut bottom: Vec<Seg> = Vec::new();
        for (k, parent) in parents.iter().enumerate() {
            if k == 0 {
                lanes[lane] = Some(Lane {
                    want: parent.to_string(),
                    color,
                    started: true,
                });
                bottom.push((lane as u16, color));
                continue;
            }
            let existing = lanes
                .iter()
                .position(|l| l.as_ref().is_some_and(|l| l.want == *parent));
            match existing {
                Some(j) if j == lane => {}
                Some(j) => {
                    let l = lanes[j].as_mut().unwrap();
                    l.started = true;
                    if !bottom.iter().any(|(b, _)| *b as usize == j) {
                        bottom.push((j as u16, l.color));
                    }
                }
                None => {
                    let j = free_lane(&mut lanes, Some(lane));
                    let c = new_color();
                    lanes[j] = Some(Lane {
                        want: parent.to_string(),
                        color: c,
                        started: true,
                    });
                    bottom.push((j as u16, c));
                }
            }
        }

        rows.push(GraphRow {
            lane: lane as u16,
            color,
            top,
            through,
            bottom,
        });
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lanes_of(rows: &[GraphRow]) -> Vec<u16> {
        rows.iter().map(|r| r.lane).collect()
    }

    #[test]
    fn linear_history_stays_in_one_lane() {
        let rows = layout(
            &[("c", vec!["b"]), ("b", vec!["a"]), ("a", vec![])],
            Some("c"),
        );
        assert_eq!(lanes_of(&rows), vec![0, 0, 0]);
        assert!(rows[0].top.is_empty());
        assert_eq!(rows[0].bottom, vec![(0, 0)]);
        assert_eq!(rows[1].top, vec![(0, 0)]);
        assert!(rows[2].bottom.is_empty());
        assert!(rows.iter().all(|r| r.through.is_empty()));
    }

    #[test]
    fn merge_opens_second_lane_and_closes_it() {
        // m merges f into main: m(a2, f) ; a2(a1) ; f(a1) ; a1
        let rows = layout(
            &[
                ("m", vec!["a2", "f"]),
                ("a2", vec!["a1"]),
                ("f", vec!["a1"]),
                ("a1", vec![]),
            ],
            Some("m"),
        );
        assert_eq!(lanes_of(&rows), vec![0, 0, 1, 0]);
        assert_eq!(rows[0].bottom.len(), 2);
        // a2 row: lane 1 passes through
        assert_eq!(rows[1].through.len(), 1);
        assert_eq!(rows[1].through[0].0, 1);
        // a1 row: both lanes converge
        let mut top: Vec<u16> = rows[3].top.iter().map(|s| s.0).collect();
        top.sort();
        assert_eq!(top, vec![0, 1]);
        assert!(rows[3].through.is_empty());
    }

    #[test]
    fn head_keeps_lane_zero_when_other_branch_is_newer() {
        // x is a newer branch tip off a; head is h.
        let rows = layout(
            &[("x", vec!["a"]), ("h", vec!["a"]), ("a", vec![])],
            Some("h"),
        );
        assert_eq!(lanes_of(&rows), vec![1, 0, 0]);
        // Reserved lane 0 is not drawn before HEAD is reached.
        assert!(rows[0].through.is_empty());
        assert_eq!(rows[1].through, vec![(1, rows[0].color)]);
    }

    #[test]
    fn freed_lane_is_reused() {
        // two short side branches one after another must share lane 1
        let rows = layout(
            &[
                ("m2", vec!["m1", "s2"]),
                ("s2", vec!["m1"]),
                ("m1", vec!["r", "s1"]),
                ("s1", vec!["r"]),
                ("r", vec![]),
            ],
            Some("m2"),
        );
        assert_eq!(lanes_of(&rows), vec![0, 1, 0, 1, 0]);
    }

    #[test]
    fn octopus_merge_gets_a_lane_per_parent() {
        let rows = layout(
            &[
                ("o", vec!["a", "b", "c"]),
                ("a", vec!["r"]),
                ("b", vec!["r"]),
                ("c", vec!["r"]),
                ("r", vec![]),
            ],
            Some("o"),
        );
        assert_eq!(rows[0].bottom.len(), 3);
        assert_eq!(lanes_of(&rows), vec![0, 0, 1, 2, 0]);
        assert_eq!(rows[4].top.len(), 3);
    }

    #[test]
    fn truncated_history_leaves_lanes_open() {
        let rows = layout(&[("b", vec!["a"])], None);
        assert_eq!(rows[0].bottom, vec![(0, 0)]);
    }
}
