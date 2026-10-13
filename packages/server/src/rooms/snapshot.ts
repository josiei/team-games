import { asPlayerId, type PlayerId } from '@tg/shared'
import type { Repo } from '../db/repo.js'
import type { InMemoryRoomStore, RoomPlayer } from './store.js'

/**
 * Rebuild live rooms from the database at boot. A crash then costs the
 * time to restart rather than the whole game night. Boot-only: uses the
 * unscoped repo reads, so it must never be called from a request.
 */
export function restoreRooms(repo: Repo, store: InMemoryRoomStore): number {
  const snapshots = new Map(repo.loadSnapshots().map(s => [s.roomId, s]))
  let restored = 0

  for (const row of repo.listRooms()) {
    const snapshot = snapshots.get(row.id)
    if (!snapshot) continue

    // Pass the database id in: the store's Map is keyed by room.id, so
    // reassigning it afterwards would leave a stale key.
    const room = store.create({
      workspaceId: row.workspaceId, code: row.code, gameId: row.gameId, id: row.id,
    })
    room.phase = snapshot.phase
    room.state = snapshot.state
    room.hostId = row.hostPlayerId
    room.restoredEndsAt = snapshot.endsAt ?? null

    // store.addPlayer would label everyone a spectator in a started room, so
    // the flag comes from the participant list saved with the snapshot. A
    // snapshot without one (older row) treats everyone as a participant.
    const participants: Set<PlayerId> | null = snapshot.participants
      ? new Set(snapshot.participants.map(asPlayerId)) : null

    for (const player of repo.listPlayersByRoom(row.id)) {
      const id = asPlayerId(player.id)
      const entry: RoomPlayer = {
        id,
        displayName: player.displayName,
        connected: false,                 // everyone reconnects
        joinedAt: player.joinedAt,
        token: player.token,
        spectator: participants ? !participants.has(id) : false,
      }
      room.players.set(id, entry)
    }
    // Nobody is connected yet, so a null host stays null until someone reconnects.
    if (!room.hostId) store.reassignHostIfNeeded(room)
    restored += 1
  }
  return restored
}
