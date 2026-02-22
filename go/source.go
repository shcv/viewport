package viewer

// SourceState manages pending and published state for the app (source) side.
//
// This mirrors the TypeScript SourceState (src/source/state.ts):
//   - App mutations go to pending state (coalesced)
//   - Flush() bundles pending ops into protocol messages
//   - Published state tracks what has been sent to the viewer
//
// Status: Stub — interface defined, implementation TODO.

// SourceState holds pending and published state for the source side.
type SourceState struct {
	// Seq is the sequence number of the last flush.
	Seq uint64

	hasPending bool
}

// NewSourceState creates a new SourceState.
func NewSourceState() *SourceState {
	return &SourceState{}
}

// SetTree sets a full tree (replaces any pending patches).
func (s *SourceState) SetTree(root *VNode) {
	// TODO: store pending tree, clear pending patches
	_ = root
	s.hasPending = true
}

// Patch applies patch operations (coalesce with existing pending patches).
func (s *SourceState) Patch(ops []PatchOp) {
	// TODO: coalesce patches per target
	_ = ops
	s.hasPending = true
}

// DefineSlot defines a slot (last-write-wins).
func (s *SourceState) DefineSlot(slot uint32, value SlotValue) {
	// TODO: store in pending slots
	_ = slot
	_ = value
	s.hasPending = true
}

// Flush bundles pending ops into protocol messages and updates published state.
// Returns the number of messages generated.
func (s *SourceState) Flush() int {
	if !s.hasPending {
		return 0
	}
	s.hasPending = false
	s.Seq++
	// TODO: build and return messages
	return 0
}

// HasPending returns true if there are pending changes to flush.
func (s *SourceState) HasPending() bool {
	return s.hasPending
}
