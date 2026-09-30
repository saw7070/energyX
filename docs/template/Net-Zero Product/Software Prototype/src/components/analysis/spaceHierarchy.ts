export type SpaceNode = {
  name: string;
  children?: SpaceNode[];
};

export function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function seeded(seed: number, offset = 0) {
  const value = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function buildSpaceRoot(projectId: string, projectName: string): SpaceNode {
  const seed = hashCode(projectId);
  const blocks = 6;

  return {
    name: projectName,
    children: Array.from({ length: blocks }, (_, blockIndex) => {
      const levels = 3 + Math.floor(seeded(seed, 20 + blockIndex) * 6);
      return {
        name: `Block ${502 + blockIndex * 2}`,
        children: Array.from({ length: levels }, (_, levelIndex) => {
          const levelName = `Level ${String(levelIndex + 1).padStart(2, "0")}`;
          const allRooms = Array.from({ length: 6 }, (_, roomIndex) => ({
            name: `Room ${String(levelIndex + 1).padStart(2, "0")}-${String(roomIndex + 1).padStart(2, "0")}`
          }));

          const blockName = `Block ${502 + blockIndex * 2}`;
          let filteredRooms = allRooms;

          // User-requested explicit removals.
          if (blockName === "Block 510" && levelName === "Level 02") {
            filteredRooms = allRooms.filter(
              (room) => !["Room 02-04", "Room 02-05", "Room 02-06"].includes(room.name)
            );
          }
          if (blockName === "Block 508" && levelName === "Level 05") {
            filteredRooms = allRooms.filter(
              (room) => !["Room 05-03", "Room 05-04"].includes(room.name)
            );
          }

          return {
            name: levelName,
            children: filteredRooms
          };
        })
      };
    })
  };
}
