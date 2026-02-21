package viewer

import "fmt"

// NewRenderTree creates an empty render tree with initialized maps.
func NewRenderTree() *RenderTree {
	return &RenderTree{
		Root:      nil,
		Slots:     make(map[int]SlotValue),
		Schemas:   make(map[int][]SchemaColumn),
		DataRows:  make(map[int][][]interface{}),
		NodeIndex: make(map[int]*RenderNode),
	}
}

// VNodeToRenderNode converts a VNode (virtual) into a RenderNode
// (materialized) and indexes all nodes into the provided map.
func VNodeToRenderNode(vnode *VNode, index map[int]*RenderNode) *RenderNode {
	if vnode == nil {
		return nil
	}

	children := make([]*RenderNode, 0, len(vnode.Children))
	for _, c := range vnode.Children {
		children = append(children, VNodeToRenderNode(c, index))
	}

	node := &RenderNode{
		ID:       vnode.ID,
		Type:     vnode.Type,
		Props:    vnode.Props,
		Children: children,
	}

	// Carry forward textAlt from VNode into the RenderNode props
	if vnode.TextAlt != nil {
		node.Props.TextAlt = vnode.TextAlt
	}

	index[node.ID] = node
	return node
}

// SetTreeRoot replaces the render tree root from a VNode, rebuilding
// the node index.
func SetTreeRoot(tree *RenderTree, root *VNode) {
	// Clear existing index
	for k := range tree.NodeIndex {
		delete(tree.NodeIndex, k)
	}
	tree.Root = VNodeToRenderNode(root, tree.NodeIndex)
}

// ApplyPatch applies a single patch operation to the render tree.
// Returns true if the patch was applied successfully.
func ApplyPatch(tree *RenderTree, op PatchOp) bool {
	if op.Remove {
		return removeNode(tree, op.Target)
	}

	if op.Replace != nil {
		return replaceNode(tree, op.Target, op.Replace)
	}

	node, ok := tree.NodeIndex[op.Target]
	if !ok {
		return false
	}

	// Set properties
	if op.Set != nil {
		applyPropsSet(node, op.Set)
	}

	// Insert child
	if op.ChildrenInsert != nil {
		child := VNodeToRenderNode(op.ChildrenInsert.Node, tree.NodeIndex)
		idx := op.ChildrenInsert.Index
		if idx > len(node.Children) {
			idx = len(node.Children)
		}
		// Insert at index
		node.Children = append(node.Children, nil)
		copy(node.Children[idx+1:], node.Children[idx:])
		node.Children[idx] = child
	}

	// Remove child
	if op.ChildrenRemove != nil {
		idx := op.ChildrenRemove.Index
		if idx >= 0 && idx < len(node.Children) {
			removed := node.Children[idx]
			removeSubtreeFromIndex(tree.NodeIndex, removed)
			node.Children = append(node.Children[:idx], node.Children[idx+1:]...)
		}
	}

	// Move child
	if op.ChildrenMove != nil {
		from := op.ChildrenMove.From
		to := op.ChildrenMove.To
		if from >= 0 && from < len(node.Children) && to >= 0 && to < len(node.Children) {
			child := node.Children[from]
			node.Children = append(node.Children[:from], node.Children[from+1:]...)
			// Insert at new position
			node.Children = append(node.Children, nil)
			copy(node.Children[to+1:], node.Children[to:])
			node.Children[to] = child
		}
	}

	return true
}

// ApplyPatches applies a batch of patch operations.
// Returns the count of successfully applied and failed patches.
func ApplyPatches(tree *RenderTree, ops []PatchOp) (applied, failed int) {
	for _, op := range ops {
		if ApplyPatch(tree, op) {
			applied++
		} else {
			failed++
		}
	}
	return applied, failed
}

// applyPropsSet merges a set of property changes into a RenderNode.
// The set map uses string keys matching JSON field names.
func applyPropsSet(node *RenderNode, set map[string]interface{}) {
	for k, v := range set {
		switch k {
		case "direction":
			if s, ok := v.(string); ok {
				node.Props.Direction = s
			}
		case "content":
			if s, ok := v.(string); ok {
				node.Props.Content = &s
			}
		case "value":
			if s, ok := v.(string); ok {
				node.Props.Value = &s
			}
		case "placeholder":
			if s, ok := v.(string); ok {
				node.Props.Placeholder = &s
			}
		case "altText":
			if s, ok := v.(string); ok {
				node.Props.AltText = &s
			}
		case "textAlt":
			if s, ok := v.(string); ok {
				node.Props.TextAlt = &s
			}
		case "disabled":
			if b, ok := v.(bool); ok {
				node.Props.Disabled = &b
			}
		case "scrollTop":
			if n, ok := toInt(v); ok {
				node.Props.ScrollTop = &n
			}
		case "scrollLeft":
			if n, ok := toInt(v); ok {
				node.Props.ScrollLeft = &n
			}
		case "weight":
			if s, ok := v.(string); ok {
				node.Props.Weight = s
			}
		case "color":
			node.Props.Color = v
		case "background":
			node.Props.Background = v
		case "justify":
			if s, ok := v.(string); ok {
				node.Props.Justify = s
			}
		case "align":
			if s, ok := v.(string); ok {
				node.Props.Align = s
			}
		case "textAlign":
			if s, ok := v.(string); ok {
				node.Props.TextAlign = s
			}
		case "fontFamily":
			if s, ok := v.(string); ok {
				node.Props.FontFamily = s
			}
		case "decoration":
			if s, ok := v.(string); ok {
				node.Props.Decoration = s
			}
		case "interactive":
			if s, ok := v.(string); ok {
				node.Props.Interactive = s
			}
		case "mode":
			if s, ok := v.(string); ok {
				node.Props.Mode = s
			}
		case "format":
			if s, ok := v.(string); ok {
				node.Props.Format = s
			}
		case "flex":
			if f, ok := toFloat(v); ok {
				node.Props.Flex = &f
			}
		case "opacity":
			if f, ok := toFloat(v); ok {
				node.Props.Opacity = &f
			}
		case "gap":
			if n, ok := toInt(v); ok {
				node.Props.Gap = &n
			}
		case "size":
			if n, ok := toInt(v); ok {
				node.Props.Size = &n
			}
		case "template":
			if n, ok := toInt(v); ok {
				node.Props.Template = &n
			}
		case "style":
			if n, ok := toInt(v); ok {
				node.Props.Style = &n
			}
		case "transition":
			if n, ok := toInt(v); ok {
				node.Props.Transition = &n
			}
		case "tabIndex":
			if n, ok := toInt(v); ok {
				node.Props.TabIndex = &n
			}
		case "width":
			node.Props.Width = v
		case "height":
			node.Props.Height = v
		case "padding":
			node.Props.Padding = v
		case "margin":
			node.Props.Margin = v
		default:
			// Store in Extra
			if node.Props.Extra == nil {
				node.Props.Extra = make(map[string]interface{})
			}
			node.Props.Extra[k] = v
		}
	}
}

// toInt attempts to convert an interface{} to int.
func toInt(v interface{}) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	case uint64:
		return int(n), true
	default:
		return 0, false
	}
}

// toFloat attempts to convert an interface{} to float64.
func toFloat(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case uint64:
		return float64(n), true
	default:
		return 0, false
	}
}

// removeNode removes a node and its subtree from the tree.
func removeNode(tree *RenderTree, targetID int) bool {
	_, ok := tree.NodeIndex[targetID]
	if !ok {
		return false
	}

	parent := findParent(tree.Root, targetID)
	if parent != nil {
		for i, c := range parent.Children {
			if c.ID == targetID {
				removeSubtreeFromIndex(tree.NodeIndex, c)
				parent.Children = append(parent.Children[:i], parent.Children[i+1:]...)
				return true
			}
		}
	} else if tree.Root != nil && tree.Root.ID == targetID {
		removeSubtreeFromIndex(tree.NodeIndex, tree.Root)
		tree.Root = nil
		return true
	}

	return false
}

// replaceNode replaces a node in the tree with a new VNode subtree.
func replaceNode(tree *RenderTree, targetID int, replacement *VNode) bool {
	existing, ok := tree.NodeIndex[targetID]
	if !ok {
		return false
	}

	// Remove old subtree from index
	removeSubtreeFromIndex(tree.NodeIndex, existing)

	// Build new subtree
	newNode := VNodeToRenderNode(replacement, tree.NodeIndex)

	// Find parent and swap
	parent := findParent(tree.Root, targetID)
	if parent != nil {
		for i, c := range parent.Children {
			if c.ID == targetID {
				parent.Children[i] = newNode
				return true
			}
		}
	} else if tree.Root != nil && tree.Root.ID == targetID {
		tree.Root = newNode
		return true
	}

	return false
}

// removeSubtreeFromIndex removes a node and all its descendants from
// the index.
func removeSubtreeFromIndex(index map[int]*RenderNode, node *RenderNode) {
	if node == nil {
		return
	}
	delete(index, node.ID)
	for _, child := range node.Children {
		removeSubtreeFromIndex(index, child)
	}
}

// findParent finds the parent of a node by ID.
func findParent(root *RenderNode, targetID int) *RenderNode {
	if root == nil {
		return nil
	}
	for _, child := range root.Children {
		if child.ID == targetID {
			return root
		}
		if found := findParent(child, targetID); found != nil {
			return found
		}
	}
	return nil
}

// ── Tree query functions ─────────────────────────────────────────────

// CountNodes returns the total number of nodes in the tree.
func CountNodes(node *RenderNode) int {
	if node == nil {
		return 0
	}
	count := 1
	for _, child := range node.Children {
		count += CountNodes(child)
	}
	return count
}

// TreeDepth returns the maximum depth of the tree.
func TreeDepth(node *RenderNode) int {
	if node == nil {
		return 0
	}
	if len(node.Children) == 0 {
		return 1
	}
	maxChildDepth := 0
	for _, child := range node.Children {
		d := TreeDepth(child)
		if d > maxChildDepth {
			maxChildDepth = d
		}
	}
	return 1 + maxChildDepth
}

// WalkTree visits all nodes in depth-first order, calling visitor
// with each node and its depth.
func WalkTree(node *RenderNode, visitor func(node *RenderNode, depth int), depth int) {
	if node == nil {
		return
	}
	visitor(node, depth)
	for _, child := range node.Children {
		WalkTree(child, visitor, depth+1)
	}
}

// FindByID finds a single node by its ID in the subtree rooted at node.
func FindByID(node *RenderNode, id int) *RenderNode {
	if node == nil {
		return nil
	}
	if node.ID == id {
		return node
	}
	for _, child := range node.Children {
		if found := FindByID(child, id); found != nil {
			return found
		}
	}
	return nil
}

// FindByText finds the first text node whose content matches the given string.
func FindByText(node *RenderNode, text string) *RenderNode {
	if node == nil {
		return nil
	}
	if node.Type == NodeText && node.Props.Content != nil && *node.Props.Content == text {
		return node
	}
	for _, child := range node.Children {
		if found := FindByText(child, text); found != nil {
			return found
		}
	}
	return nil
}

// FindNodes returns all nodes matching a predicate.
func FindNodes(node *RenderNode, predicate func(*RenderNode) bool) []*RenderNode {
	var results []*RenderNode
	WalkTree(node, func(n *RenderNode, _ int) {
		if predicate(n) {
			results = append(results, n)
		}
	}, 0)
	return results
}

// TreeString returns a debug string representation of the tree.
func TreeString(node *RenderNode) string {
	if node == nil {
		return "(nil)"
	}
	result := ""
	WalkTree(node, func(n *RenderNode, depth int) {
		indent := ""
		for i := 0; i < depth; i++ {
			indent += "  "
		}
		result += fmt.Sprintf("%s%s#%d", indent, n.Type, n.ID)
		if n.Type == NodeText && n.Props.Content != nil {
			result += fmt.Sprintf(" %q", *n.Props.Content)
		}
		result += "\n"
	}, 0)
	return result
}
