/**
 * Clusters as balls in three dimensions, so they can be turned.
 *
 * The grouped and clustered views used to be flat: one phyllotaxis DISC per
 * group, laid out by Cytoscape. A disc is the wrong shape for a few hundred
 * nodes — the middle of it is a solid mat you cannot see into, and there is
 * nothing rotation could reveal because there is no depth to reveal.
 *
 * Filling a BALL instead fixes both. The same nodes occupy a volume rather than
 * a plate, so the interior thins out; and turning it moves the near face past
 * the far one, which is what lets you see which nodes a dense group actually
 * holds. The hulls are recomputed from the projection each frame, so the outline
 * and its count follow the rotation instead of drifting off the group.
 *
 * Positions are computed, not simulated — same as the shell — so switching to
 * one of these views is instant and always lands the same way.
 */
import type { Point3 } from './force3d';
import type { GraphModel } from './model';

/** How far apart two nodes in a ball should sit, and the clear space between
    one ball's surface and the next. */
const SPACING = 34, GAP = 130;

/**
 * Two irrationals that make a low-discrepancy sequence in the unit square.
 *
 * The obvious "index / count" for the polar angle correlates depth with height,
 * which stacks a ball's outer nodes at its poles. Driving the two angles from
 * independent sequences spreads them evenly instead.
 */
const A1 = 0.8191725133961644, A2 = 0.6710436067037893;
const frac = (v: number) => v - Math.floor(v);

/** Radius a ball needs to hold `n` nodes SPACING apart. */
function ballRadius(n: number): number {
  return SPACING * Math.cbrt((3 * Math.max(1, n)) / (4 * Math.PI));
}

/** The k-th of n points filling a ball of radius R, evenly through the volume.
    The cube root is what makes it even: without it every point lands near the
    surface, because most of a ball's volume is out there. */
function ballPoint(k: number, n: number, R: number): Point3 {
  const r = R * Math.cbrt((k + 0.5) / Math.max(1, n));
  const cosPhi = 1 - 2 * frac(0.5 + A1 * k);
  const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
  const theta = 2 * Math.PI * frac(0.5 + A2 * k);
  return {
    x: r * sinPhi * Math.cos(theta),
    y: r * cosPhi,
    z: r * sinPhi * Math.sin(theta),
  };
}

/**
 * Where the ball centres go: evenly around a ring, each nudged up or down.
 *
 * A sphere spread looked more three-dimensional and read worse — from any one
 * viewpoint some balls sit behind others, and "not collected" spent most of the
 * spin hidden inside "on track". A ring is horizontal, and the idle spin turns
 * about the vertical axis, so the balls orbit past each other like a carousel
 * and every one comes to the front. The vertical nudge stops two of them lining
 * up when the ring goes edge-on.
 */
function ringDirection(i: number, n: number): Point3 {
  const a = (i / Math.max(1, n)) * Math.PI * 2;
  const lift = 0.34 * (2 * frac(0.5 + A1 * i) - 1);
  return { x: Math.cos(a), y: lift, z: Math.sin(a) };
}

export interface ClusterPlacement {
  positions: Map<number, Point3>;
  /** group key and size, in the order they were laid out */
  groups: { key: string; count: number }[];
}

/**
 * Place every visible node inside its group's ball.
 *
 * The balls sit on a sphere of their own, pushed out far enough that the two
 * closest never touch — computed from the actual directions rather than guessed,
 * so it still holds when a layer toggle changes how many groups there are.
 */
export function clusterPlacement(ids: number[], model: GraphModel,
                                 by: 'type' | 'outcome'): ClusterPlacement {
  const keyOf = (id: number) => {
    const node = model.nodes[id];
    if (!node) return 'context';
    return by === 'type' ? node.type : model.outcomeOf(node);
  };

  const members = new Map<string, number[]>();
  for (const id of ids) {
    const key = keyOf(id);
    const list = members.get(key);
    if (list) list.push(id); else members.set(key, [id]);
  }

  const keys = [...members.keys()].sort();
  const radii = keys.map((k) => ballRadius(members.get(k)!.length));
  const directions = keys.map((_, i) => ringDirection(i, keys.length));

  /* how close two of these directions get on the unit sphere — one ball centre
     to another, before scaling */
  let closest = Infinity;
  for (let i = 0; i < directions.length; i++) {
    for (let j = i + 1; j < directions.length; j++) {
      const a = directions[i], b = directions[j];
      closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }
  const widest = Math.max(1, ...radii);
  /* one ball is centred, not orbiting, so a single group needs no spread */
  const spread = keys.length < 2 ? 0
    : (2 * widest + GAP) / (closest === Infinity ? 1 : closest);

  const positions = new Map<number, Point3>();
  keys.forEach((key, i) => {
    const list = members.get(key)!;
    const centre = directions[i];
    const R = radii[i];
    list.forEach((id, k) => {
      const p = ballPoint(k, list.length, R);
      positions.set(id, {
        x: centre.x * spread + p.x,
        y: centre.y * spread + p.y,
        z: centre.z * spread + p.z,
      });
    });
  });

  return { positions, groups: keys.map((k) => ({ key: k, count: members.get(k)!.length })) };
}
