package viewer

import (
	"encoding/binary"
	"testing"
)

// ── Wire format tests ────────────────────────────────────────────────

func TestEncodeDecodeHeader(t *testing.T) {
	header := EncodeHeader(MsgTree, 42)

	decoded, err := DecodeHeader(header)
	if err != nil {
		t.Fatalf("DecodeHeader failed: %v", err)
	}

	if decoded.Magic != Magic {
		t.Errorf("magic = 0x%04x, want 0x%04x", decoded.Magic, Magic)
	}
	if decoded.Version != ProtocolVersion {
		t.Errorf("version = %d, want %d", decoded.Version, ProtocolVersion)
	}
	if decoded.Type != MsgTree {
		t.Errorf("type = %d, want %d", decoded.Type, MsgTree)
	}
	if decoded.Length != 42 {
		t.Errorf("length = %d, want 42", decoded.Length)
	}
}

func TestDecodeHeaderBadMagic(t *testing.T) {
	buf := make([]byte, HeaderSize)
	binary.BigEndian.PutUint16(buf[0:2], 0x0000) // bad magic

	_, err := DecodeHeader(buf)
	if err != ErrBadMagic {
		t.Errorf("expected ErrBadMagic, got %v", err)
	}
}

func TestDecodeHeaderTooShort(t *testing.T) {
	_, err := DecodeHeader([]byte{0x56, 0x50})
	if err != ErrBufferTooShort {
		t.Errorf("expected ErrBufferTooShort, got %v", err)
	}
}

func TestFrameReader(t *testing.T) {
	fr := NewFrameReader()

	// Build a complete frame
	payload := []byte{0x01, 0x02, 0x03}
	header := EncodeHeader(MsgDefine, uint32(len(payload)))
	frame := make([]byte, HeaderSize+len(payload))
	copy(frame[0:], header)
	copy(frame[HeaderSize:], payload)

	// Feed partial data first
	frames, err := fr.Feed(frame[:4])
	if err != nil {
		t.Fatalf("Feed partial: %v", err)
	}
	if len(frames) != 0 {
		t.Errorf("expected 0 frames from partial data, got %d", len(frames))
	}

	// Feed the rest
	frames, err = fr.Feed(frame[4:])
	if err != nil {
		t.Fatalf("Feed rest: %v", err)
	}
	if len(frames) != 1 {
		t.Fatalf("expected 1 frame, got %d", len(frames))
	}

	if frames[0].Header.Type != MsgDefine {
		t.Errorf("frame type = %d, want %d", frames[0].Header.Type, MsgDefine)
	}
	if len(frames[0].Payload) != len(payload) {
		t.Errorf("payload length = %d, want %d", len(frames[0].Payload), len(payload))
	}
}

func TestFrameReaderMultipleFrames(t *testing.T) {
	fr := NewFrameReader()

	// Build two frames concatenated
	payload1 := []byte{0xAA}
	payload2 := []byte{0xBB, 0xCC}
	h1 := EncodeHeader(MsgTree, uint32(len(payload1)))
	h2 := EncodeHeader(MsgPatch, uint32(len(payload2)))

	var data []byte
	data = append(data, h1...)
	data = append(data, payload1...)
	data = append(data, h2...)
	data = append(data, payload2...)

	frames, err := fr.Feed(data)
	if err != nil {
		t.Fatalf("Feed: %v", err)
	}
	if len(frames) != 2 {
		t.Fatalf("expected 2 frames, got %d", len(frames))
	}
	if frames[0].Header.Type != MsgTree {
		t.Errorf("frame 0 type = %d, want %d", frames[0].Header.Type, MsgTree)
	}
	if frames[1].Header.Type != MsgPatch {
		t.Errorf("frame 1 type = %d, want %d", frames[1].Header.Type, MsgPatch)
	}
}

// ── Tree operation tests ─────────────────────────────────────────────

func strPtr(s string) *string { return &s }

func makeSimpleTree() *VNode {
	return &VNode{
		ID:   1,
		Type: NodeBox,
		Props: NodeProps{
			Direction: "column",
		},
		Children: []*VNode{
			{
				ID:    2,
				Type:  NodeText,
				Props: NodeProps{Content: strPtr("Hello")},
			},
			{
				ID:    3,
				Type:  NodeText,
				Props: NodeProps{Content: strPtr("World")},
			},
		},
	}
}

func TestNewRenderTree(t *testing.T) {
	tree := NewRenderTree()
	if tree.Root != nil {
		t.Error("expected nil root")
	}
	if len(tree.Slots) != 0 {
		t.Error("expected empty slots")
	}
	if len(tree.NodeIndex) != 0 {
		t.Error("expected empty node index")
	}
}

func TestSetTreeRoot(t *testing.T) {
	tree := NewRenderTree()
	vnode := makeSimpleTree()

	SetTreeRoot(tree, vnode)

	if tree.Root == nil {
		t.Fatal("expected non-nil root")
	}
	if tree.Root.ID != 1 {
		t.Errorf("root ID = %d, want 1", tree.Root.ID)
	}
	if len(tree.NodeIndex) != 3 {
		t.Errorf("node index size = %d, want 3", len(tree.NodeIndex))
	}
	// Check all nodes are indexed
	for _, id := range []int{1, 2, 3} {
		if _, ok := tree.NodeIndex[id]; !ok {
			t.Errorf("node %d not in index", id)
		}
	}
}

func TestApplyPatchSet(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, makeSimpleTree())

	ok := ApplyPatch(tree, PatchOp{
		Target: 2,
		Set:    map[string]interface{}{"content": "Changed"},
	})

	if !ok {
		t.Fatal("ApplyPatch returned false")
	}

	node := tree.NodeIndex[2]
	if node.Props.Content == nil || *node.Props.Content != "Changed" {
		t.Errorf("content = %v, want 'Changed'", node.Props.Content)
	}
}

func TestApplyPatchRemove(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, makeSimpleTree())

	ok := ApplyPatch(tree, PatchOp{
		Target: 3,
		Remove: true,
	})

	if !ok {
		t.Fatal("ApplyPatch returned false")
	}

	if len(tree.Root.Children) != 1 {
		t.Errorf("children count = %d, want 1", len(tree.Root.Children))
	}
	if _, exists := tree.NodeIndex[3]; exists {
		t.Error("removed node still in index")
	}
}

func TestApplyPatchChildrenInsert(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, makeSimpleTree())

	newChild := &VNode{
		ID:    4,
		Type:  NodeText,
		Props: NodeProps{Content: strPtr("Inserted")},
	}

	ok := ApplyPatch(tree, PatchOp{
		Target: 1,
		ChildrenInsert: &ChildrenInsert{
			Index: 1,
			Node:  newChild,
		},
	})

	if !ok {
		t.Fatal("ApplyPatch returned false")
	}

	if len(tree.Root.Children) != 3 {
		t.Errorf("children count = %d, want 3", len(tree.Root.Children))
	}
	if tree.Root.Children[1].ID != 4 {
		t.Errorf("inserted child ID = %d, want 4", tree.Root.Children[1].ID)
	}
}

func TestApplyPatches(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, makeSimpleTree())

	applied, failed := ApplyPatches(tree, []PatchOp{
		{Target: 2, Set: map[string]interface{}{"content": "A"}},
		{Target: 3, Set: map[string]interface{}{"content": "B"}},
		{Target: 999, Set: map[string]interface{}{"content": "C"}}, // non-existent
	})

	if applied != 2 {
		t.Errorf("applied = %d, want 2", applied)
	}
	if failed != 1 {
		t.Errorf("failed = %d, want 1", failed)
	}
}

func TestCountNodes(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, makeSimpleTree())

	count := CountNodes(tree.Root)
	if count != 3 {
		t.Errorf("count = %d, want 3", count)
	}
}

func TestCountNodesNil(t *testing.T) {
	count := CountNodes(nil)
	if count != 0 {
		t.Errorf("count = %d, want 0", count)
	}
}

func TestTreeDepth(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, makeSimpleTree())

	depth := TreeDepth(tree.Root)
	if depth != 2 {
		t.Errorf("depth = %d, want 2", depth)
	}
}

func TestTreeDepthNil(t *testing.T) {
	depth := TreeDepth(nil)
	if depth != 0 {
		t.Errorf("depth = %d, want 0", depth)
	}
}

func TestFindByID(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, makeSimpleTree())

	node := FindByID(tree.Root, 2)
	if node == nil {
		t.Fatal("expected non-nil node")
	}
	if node.ID != 2 {
		t.Errorf("ID = %d, want 2", node.ID)
	}
}

func TestFindByIDNotFound(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, makeSimpleTree())

	node := FindByID(tree.Root, 999)
	if node != nil {
		t.Error("expected nil for non-existent ID")
	}
}

func TestFindByText(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, makeSimpleTree())

	node := FindByText(tree.Root, "Hello")
	if node == nil {
		t.Fatal("expected non-nil node")
	}
	if node.ID != 2 {
		t.Errorf("ID = %d, want 2", node.ID)
	}
}

// ── Text projection tests ────────────────────────────────────────────

func TestTextProjectionSimple(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, makeSimpleTree())

	text := TextProjection(tree)
	if text == "" {
		t.Fatal("expected non-empty text projection")
	}
	if !containsStr(text, "Hello") {
		t.Errorf("text projection missing 'Hello': %s", text)
	}
	if !containsStr(text, "World") {
		t.Errorf("text projection missing 'World': %s", text)
	}
}

func TestTextProjectionEmpty(t *testing.T) {
	tree := NewRenderTree()
	text := TextProjection(tree)
	if text != "" {
		t.Errorf("expected empty text, got %q", text)
	}
}

func TestTextProjectionRowBox(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, &VNode{
		ID:   1,
		Type: NodeBox,
		Props: NodeProps{
			Direction: "row",
		},
		Children: []*VNode{
			{ID: 2, Type: NodeText, Props: NodeProps{Content: strPtr("A")}},
			{ID: 3, Type: NodeText, Props: NodeProps{Content: strPtr("B")}},
		},
	})

	text := TextProjection(tree)
	// Row boxes join children with tab
	if text != "A\tB" {
		t.Errorf("text = %q, want %q", text, "A\tB")
	}
}

func TestTextProjectionInput(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, &VNode{
		ID:   1,
		Type: NodeInput,
		Props: NodeProps{
			Value:       strPtr("typed text"),
			Placeholder: strPtr("placeholder"),
		},
	})

	text := TextProjection(tree)
	if text != "typed text" {
		t.Errorf("text = %q, want %q", text, "typed text")
	}
}

func TestTextProjectionInputPlaceholder(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, &VNode{
		ID:   1,
		Type: NodeInput,
		Props: NodeProps{
			Placeholder: strPtr("placeholder"),
		},
	})

	text := TextProjection(tree)
	if text != "placeholder" {
		t.Errorf("text = %q, want %q", text, "placeholder")
	}
}

func TestTextProjectionSeparator(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, &VNode{
		ID:   1,
		Type: NodeSeparator,
	})

	text := TextProjection(tree)
	if text != "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500" {
		t.Errorf("separator text = %q", text)
	}
}

func TestTextProjectionImage(t *testing.T) {
	tree := NewRenderTree()
	altText := "a photo"
	SetTreeRoot(tree, &VNode{
		ID:    1,
		Type:  NodeImage,
		Props: NodeProps{AltText: &altText},
	})

	text := TextProjection(tree)
	if text != "a photo" {
		t.Errorf("text = %q, want %q", text, "a photo")
	}
}

func TestTextProjectionImageNoAlt(t *testing.T) {
	tree := NewRenderTree()
	SetTreeRoot(tree, &VNode{
		ID:   1,
		Type: NodeImage,
	})

	text := TextProjection(tree)
	if text != "[image]" {
		t.Errorf("text = %q, want %q", text, "[image]")
	}
}

func TestTextProjectionTextAlt(t *testing.T) {
	tree := NewRenderTree()
	alt := "override"
	SetTreeRoot(tree, &VNode{
		ID:      1,
		Type:    NodeText,
		Props:   NodeProps{Content: strPtr("original")},
		TextAlt: &alt,
	})

	text := TextProjection(tree)
	if text != "override" {
		t.Errorf("text = %q, want %q", text, "override")
	}
}

// ── Viewer tests ─────────────────────────────────────────────────────

func TestNewViewer(t *testing.T) {
	v := NewViewer(HeadlessTarget{})
	if v == nil {
		t.Fatal("expected non-nil viewer")
	}

	tree := v.GetTree()
	if tree.Root != nil {
		t.Error("expected nil root on new viewer")
	}
}

func TestViewerSetTree(t *testing.T) {
	v := NewViewer(HeadlessTarget{})
	v.SetTree(makeSimpleTree())

	tree := v.GetTree()
	if tree.Root == nil {
		t.Fatal("expected non-nil root after SetTree")
	}
	if tree.Root.ID != 1 {
		t.Errorf("root ID = %d, want 1", tree.Root.ID)
	}
}

func TestViewerGetTextProjection(t *testing.T) {
	v := NewViewer(HeadlessTarget{})
	v.SetTree(makeSimpleTree())

	text := v.GetTextProjection()
	if !containsStr(text, "Hello") {
		t.Errorf("text projection missing 'Hello': %s", text)
	}
}

func TestViewerApplyPatches(t *testing.T) {
	v := NewViewer(HeadlessTarget{})
	v.SetTree(makeSimpleTree())

	v.ApplyPatches([]PatchOp{
		{Target: 2, Set: map[string]interface{}{"content": "Modified"}},
	})

	text := v.GetTextProjection()
	if !containsStr(text, "Modified") {
		t.Errorf("text projection missing 'Modified': %s", text)
	}
}

func TestViewerDefineSlot(t *testing.T) {
	v := NewViewer(HeadlessTarget{})
	v.DefineSlot(5, ColorSlot{Kind: "color", Role: "primary", Value: "#ff0000"})

	tree := v.GetTree()
	if len(tree.Slots) != 1 {
		t.Errorf("slots count = %d, want 1", len(tree.Slots))
	}
}

func TestViewerMetrics(t *testing.T) {
	v := NewViewer(HeadlessTarget{})
	v.SetTree(makeSimpleTree())
	v.ApplyPatches([]PatchOp{
		{Target: 2, Set: map[string]interface{}{"content": "Changed"}},
	})

	metrics := v.GetMetrics()
	if metrics.MessagesProcessed != 2 {
		t.Errorf("messagesProcessed = %d, want 2", metrics.MessagesProcessed)
	}
	if metrics.TreeNodeCount != 3 {
		t.Errorf("treeNodeCount = %d, want 3", metrics.TreeNodeCount)
	}
	if metrics.TreeDepth != 2 {
		t.Errorf("treeDepth = %d, want 2", metrics.TreeDepth)
	}
}

func TestViewerRender(t *testing.T) {
	v := NewViewer(HeadlessTarget{})
	v.SetTree(makeSimpleTree())

	changed := v.Render()
	if !changed {
		t.Error("expected Render() to return true on dirty tree")
	}

	changed = v.Render()
	if changed {
		t.Error("expected Render() to return false on clean tree")
	}
}

func TestViewerScreenshot(t *testing.T) {
	v := NewViewer(HeadlessTarget{})
	v.SetTree(makeSimpleTree())

	ss := v.Screenshot()
	if ss.Format != "ansi" {
		t.Errorf("format = %s, want ansi", ss.Format)
	}
	if ss.Data == "" {
		t.Error("expected non-empty screenshot data")
	}
}

func TestViewerDestroy(t *testing.T) {
	v := NewViewer(HeadlessTarget{})
	v.SetTree(makeSimpleTree())
	v.Destroy()

	tree := v.GetTree()
	if tree.Root != nil {
		t.Error("expected nil root after Destroy")
	}
}

func TestViewerProcessMessage(t *testing.T) {
	v := NewViewer(HeadlessTarget{})

	v.ProcessMessage(ProtocolMessage{
		Type: MsgTree,
		Root: makeSimpleTree(),
	})

	tree := v.GetTree()
	if tree.Root == nil {
		t.Fatal("expected non-nil root after ProcessMessage")
	}
	if CountNodes(tree.Root) != 3 {
		t.Errorf("node count = %d, want 3", CountNodes(tree.Root))
	}
}

func TestViewerTrackBytes(t *testing.T) {
	v := NewViewer(HeadlessTarget{})
	v.TrackBytes(100)
	v.TrackBytes(200)

	metrics := v.GetMetrics()
	if metrics.BytesReceived != 300 {
		t.Errorf("bytesReceived = %d, want 300", metrics.BytesReceived)
	}
}

// ── Helpers ──────────────────────────────────────────────────────────

func containsStr(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && findSubstr(s, substr))
}

func findSubstr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
