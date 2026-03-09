

# Plan: Transform Shared Space from 2-Person to Multi-Member (up to 10)

## Problem Statement
The current "couple" model is hardcoded for exactly 2 people throughout the codebase -- from the database schema (with `you_name` / `partner_name` fields) to the frontend identity resolution (binary creator/partner swap). This needs to evolve into a multi-member shared space (up to 10 people) while preserving all existing functionality.

---

## Architecture Overview

The transformation follows a **progressive widening** strategy: expand the data layer first, then adapt the identity layer, then update UI components.

```text
Current Model:                    Target Model:
┌─────────────────┐              ┌─────────────────────┐
│  clerk_couples   │              │  clerk_spaces        │
│  you_name        │     →       │  name (space title)   │
│  partner_name    │              │  max_members: 10      │
│  created_by      │              │  created_by           │
└────────┬────────┘              └────────┬─────────────┘
         │                                │
  clerk_couple_members              clerk_couple_members
  (max 2 rows)                     (up to 10 rows)
  owner | member                   owner | member
                                   + display_name per member
```

**Key Decision: Rename or Keep "couple" naming?**
To avoid breaking changes across 30+ files, RLS policies, RPC functions, edge functions, and WhatsApp integration, we will **keep the existing table names** (`clerk_couples`, `clerk_couple_members`) but evolve the schema. A future cosmetic rename can happen later. The user-facing terminology changes from "Couple" to "Space."

---

## Phase 1: Database Schema Evolution

### 1a. Add `display_name` to `clerk_couple_members`
Currently, identity is resolved by checking `created_by` and using `you_name`/`partner_name`. With N members, each member needs their own display name stored in the membership table.

**Migration:**
- Add `display_name TEXT` to `clerk_couple_members`
- Add `max_members INT DEFAULT 10` to `clerk_couples`
- Backfill existing members: set `display_name` = `you_name` for owner, `partner_name` for existing partner member
- Keep `you_name`/`partner_name` columns temporarily for backward compatibility

### 1b. New RPC: `add_member_to_space`
A new server-side function that enforces the 10-member cap:
```sql
CREATE FUNCTION add_member_to_space(p_couple_id uuid, p_user_id text, p_display_name text, p_role member_role DEFAULT 'member')
-- Check member count < max_members before inserting
```

### 1c. New RPC: `get_space_members`
Returns all members of a space with their display names and profile info, used by both frontend and edge functions.

### 1d. Update `create_couple` RPC
Set the owner's `display_name` in `clerk_couple_members` during creation.

### 1e. Update `accept_invite` RPC
Set the joining member's `display_name` (from their `clerk_profiles.display_name`) and enforce the member cap.

---

## Phase 2: Identity Resolution Layer (Core Change)

### Current (binary):
```
isCreator ? you_name : partner_name
```

### Target (N-member):
```
members.find(m => m.user_id === currentUserId).display_name  → "You"
members.filter(m => m.user_id !== currentUserId)             → other members
```

### 2a. Update `useSupabaseCouples.ts`
- Fetch all members for each space via a join or separate query
- Replace `resolvedYouName` / `resolvedPartnerName` with a `members` array
- Expose: `currentUserMember`, `otherMembers`, `getMemberName(userId)`
- Keep `you` / `partner` on the provider for backward compat (partner = first other member or comma-joined names)

### 2b. Update `SupabaseCoupleProvider.tsx`
- Add `members: SpaceMember[]` to context
- Add `getMemberName(authorId: string): string` helper
- Deprecate but keep `partner` as a computed string (e.g., "Alex, Sam" for multi-member)

### 2c. Update `SupabaseNotesProvider.tsx`
- Replace the binary `getAuthorName` logic with a member lookup
- `getAuthorName(authorId)` → look up from `members` map, fallback to "Unknown"
- Same for `getTaskOwnerName`

---

## Phase 3: Frontend UI Changes

### 3a. Settings Page: Members Section (replaces PartnerInfo)
Transform the current `PartnerInfo.tsx` into a `SpaceMembersCard.tsx`:
- Show list of all current members with avatars/names and roles (Owner badge)
- "Invite Member" button (disabled if at capacity, shows "X/10 members")
- Each member row: name, role badge, remove button (owner only, cannot remove self)
- Invite flow generates link (reuse existing `create_invite` RPC)

### 3b. Update `PartnerActivityWidget.tsx`
- Show activity from **all** other members, not just one partner
- Group by member or show member name per activity item
- Rename to `MemberActivityWidget` (keep old export for compat)

### 3c. Update `PartnerInviteCard.tsx` (Home page nudge)
- Change copy from "Invite your partner" to "Invite people to your space"
- Show member count ("2/10 members")

### 3d. Update `InviteFlow.tsx` (Onboarding)
- Keep existing flow but change wording from "partner" to "member"
- Allow skipping (already supported via "Set Up My Space Only")

### 3e. Update `AcceptInvite.tsx`
- Change "Couple Space" label to "Shared Space"
- Show space name and member count

### 3f. NoteRecap task owner dropdown
- Currently shows only you + partner. Expand to show all members.

---

## Phase 4: Edge Function Updates

### 4a. `process-note/index.ts`
- Task assignment: when a member name is mentioned, resolve against **all** members (not just binary you/partner)
- Use `get_space_members` RPC or direct query to get member list

### 4b. `whatsapp-webhook/index.ts`
- Partner name resolution currently uses `created_by` + binary swap
- Replace with member list lookup for the space
- When relaying to "partner," determine which member(s) to notify

### 4c. `whatsapp-gateway/index.ts`
- Same identity resolution updates as webhook

---

## Phase 5: i18n Updates
- Update translation keys across `en`, `it-IT`, `es-ES`:
  - "Partner" → "Members" / "Membri" / "Miembros" where contextually appropriate
  - "Couple Space" → "Shared Space" / "Spazio Condiviso" / "Espacio Compartido"
  - Keep "partner" in contexts where it still makes sense (e.g., 2-person spaces)

---

## Backward Compatibility Guarantees

1. **`you_name` / `partner_name` columns remain** -- they become the display names for the first two members and are kept in sync via a trigger or application logic
2. **`partner` field in context** stays available -- computed as comma-separated names of other members
3. **All existing RLS policies unchanged** -- they check `couple_id` membership which already works for N members
4. **Existing invites continue to work** -- the `accept_invite` RPC just adds a member
5. **WhatsApp integration** -- initially continues to work with first-partner logic, then progressively enhanced

---

## Implementation Order (Recommended)

| Step | What | Risk |
|------|------|------|
| 1 | DB migration: add `display_name` to members, `max_members` to couples | Low |
| 2 | Update RPCs: `create_couple`, `accept_invite`, new `get_space_members` | Low |
| 3 | Update `useSupabaseCouples` + provider with members array | Medium |
| 4 | Update `SupabaseNotesProvider` identity resolution | Medium |
| 5 | Build `SpaceMembersCard` settings UI | Low |
| 6 | Update `PartnerActivityWidget`, `PartnerInviteCard`, `AcceptInvite` | Low |
| 7 | Update `process-note` edge function member resolution | Medium |
| 8 | Update WhatsApp edge functions | High (complex) |
| 9 | i18n translation updates | Low |

Total estimated scope: ~15-20 files modified, 2-3 new RPCs, 1 migration, 3 edge function updates.

