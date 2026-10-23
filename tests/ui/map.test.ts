// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  atlasModel,
  describePlace,
  insidePolygon,
  MAP_H,
  MAP_W,
  pickAt,
  regionAt,
} from '../../src/ui/map/atlas';
import { GRAND_LINE_NAMES } from '../../src/ui/map/atlas-data.js';
import { createWorldMap } from '../../src/ui/map/world-map';
import { data } from '../helpers/data';

describe('the world map model', () => {
  it('is the supplied map: its places, notes and islands, the same every time', () => {
    const model = atlasModel();
    expect(model).toBe(atlasModel()); // built once per page
    expect(model.places.length).toBeGreaterThan(140);
    expect(model.lobes.length).toBeGreaterThan(300);
    expect(model.notes.get('Fish-Man Island')?.text).toMatch(
      /undersea island beneath the Red Line/,
    );
    for (const name of ['Wano Kingdom', 'Elbaf', 'Zou', 'Skypiea', 'Logue Town', 'God Valley']) {
      expect(
        model.places.some((p) => p.name === name),
        name,
      ).toBe(true);
    }
    expect(GRAND_LINE_NAMES.length).toBe(93);
  });

  it('knows which sea a point is in', () => {
    expect(regionAt(300, 200)).toBe('North Blue');
    expect(regionAt(2300, 200)).toBe('East Blue');
    expect(regionAt(300, 1100)).toBe('West Blue');
    expect(regionAt(2300, 1100)).toBe('South Blue');
    expect(regionAt(600, 660)).toBe('New World');
    expect(regionAt(1800, 660)).toBe('Paradise');
    expect(regionAt(1250, 300)).toBe('Red Line');
  });

  it('tells inside from outside', () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(insidePolygon(5, 5, square)).toBe(true);
    expect(insidePolygon(15, 5, square)).toBe(false);
  });

  it('finds the place under a click, with its notes and its parts', () => {
    const dressrosa = pickAt(233, 736, false, 9);
    expect(dressrosa.name).toBe('Dressrosa Kingdom');
    expect(dressrosa.where).toBe('Kingdom in the New World');
    expect(dressrosa.links.map((l) => l.name)).toEqual(
      expect.arrayContaining(['Green Bit', 'Corrida Colosseum']),
    );
    // Open sea gives the sea's own note.
    expect(pickAt(1800, 560, false, 9).name).toBe('Calm Belt');
    expect(pickAt(600, 1250, false, 9).where).toBeTruthy();
    expect(describePlace('Wano Kingdom')?.text).toMatch(/samurai/);
    expect(describePlace('Nowhere at all')).toBeNull();
  });

  it('puts every birthplace on the map, in the right part of the world', () => {
    const expected: Record<string, string[]> = {
      east_blue: ['East Blue'],
      west_blue: ['West Blue'],
      north_blue: ['North Blue'],
      south_blue: ['South Blue'],
      paradise: ['Paradise'],
      sky: ['Paradise'],
      new_world: ['New World'],
      wano: ['New World'],
      fishman_island: ['New World', 'Red Line'],
    };
    for (const place of Object.values(data.birthplaces)) {
      expect(place.map, place.id).toBeDefined();
      const { x, y } = place.map as { x: number; y: number };
      expect(x >= 0 && x <= MAP_W && y >= 0 && y <= MAP_H, place.id).toBe(true);
      expect(expected[place.region], place.id).toContain(regionAt(x, y));
    }
  });
});

describe('the world map widget', () => {
  it('draws the map, takes pins, and picks a birthplace by keyboard', () => {
    const picked: string[] = [];
    const map = createWorldMap({ label: 'Test map', onPin: (id) => picked.push(id) });
    document.body.append(map.el);
    expect(map.el.querySelector('svg.atlas')?.getAttribute('aria-label')).toBe('Test map');
    expect(map.el.querySelectorAll('.atlas__label').length).toBeGreaterThan(100);
    map.setPins([
      { id: 'a', x: 100, y: 100, label: 'A', kind: 'open', title: 'Place A' },
      { id: 'b', x: 200, y: 200, label: 'B', kind: 'closed', title: 'Place B: closed' },
      {
        id: 'c',
        x: 300,
        y: 300,
        label: 'C',
        kind: 'chosen',
        labelled: true,
        title: 'Place C (chosen)',
      },
    ]);
    const pins = [...map.el.querySelectorAll<SVGGElement>('.atlas-pin')];
    expect(pins.map((p) => p.getAttribute('role'))).toEqual(['button', 'img', 'button']);
    expect(pins[1]?.getAttribute('tabindex')).toBeNull();
    expect(pins[2]?.getAttribute('aria-pressed')).toBe('true');
    pins[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    pins[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(picked).toEqual(['a']);
    map.destroy();
    map.el.remove();
  });
});
