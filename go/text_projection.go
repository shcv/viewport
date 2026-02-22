package viewer

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// TextProjectionOptions controls how text projection is computed.
type TextProjectionOptions struct {
	// BoxSeparator defines separators between box children.
	// Defaults: Row = "\t", Column = "\n".
	BoxSeparatorRow    string
	BoxSeparatorColumn string

	// FullScrollContent includes scroll content beyond the visible range.
	FullScrollContent bool

	// MaxWidth for wrapping (0 = no wrap).
	MaxWidth int

	// IndentSize is the number of spaces per nesting level.
	IndentSize int
}

// DefaultTextProjectionOptions returns the default options.
func DefaultTextProjectionOptions() TextProjectionOptions {
	return TextProjectionOptions{
		BoxSeparatorRow:    "\t",
		BoxSeparatorColumn: "\n",
		FullScrollContent:  true,
		MaxWidth:           0,
		IndentSize:         0,
	}
}

// TextProjection computes the text projection of an entire render tree.
// This is the primary output for headless/testing mode.
func TextProjection(tree *RenderTree) string {
	return TextProjectionWithOptions(tree, DefaultTextProjectionOptions())
}

// TextProjectionWithOptions computes the text projection with custom options.
func TextProjectionWithOptions(tree *RenderTree, opts TextProjectionOptions) string {
	if tree.Root == nil {
		return ""
	}
	return projectNode(tree.Root, tree, opts, 0)
}

// projectNode computes the text projection for a single node.
func projectNode(node *RenderNode, tree *RenderTree, opts TextProjectionOptions, depth int) string {
	if node == nil {
		return ""
	}

	// Check for explicit textAlt override
	if node.Props.TextAlt != nil {
		return *node.Props.TextAlt
	}

	indent := ""
	if opts.IndentSize > 0 {
		indent = strings.Repeat(" ", depth*opts.IndentSize)
	}

	switch node.Type {
	case NodeText:
		content := ""
		if node.Props.Content != nil {
			content = *node.Props.Content
		}
		return indent + content

	case NodeBox:
		dir := node.Props.Direction
		if dir == "" {
			dir = "column"
		}
		sep := opts.BoxSeparatorColumn
		if dir == "row" {
			sep = opts.BoxSeparatorRow
		}

		childTexts := make([]string, 0, len(node.Children))
		for _, child := range node.Children {
			t := projectNode(child, tree, opts, depth+1)
			if len(t) > 0 {
				childTexts = append(childTexts, t)
			}
		}
		return strings.Join(childTexts, sep)

	case NodeScroll:
		childTexts := make([]string, 0, len(node.Children))
		for _, child := range node.Children {
			t := projectNode(child, tree, opts, depth+1)
			if len(t) > 0 {
				childTexts = append(childTexts, t)
			}
		}

		// If the scroll has a template and data rows, project those too
		if node.Props.Template != nil {
			templateSlotID := *node.Props.Template
			if slotVal, ok := tree.Slots[templateSlotID]; ok {
				if rt, ok := slotVal.(RowTemplateSlot); ok {
					schemaSlotID := rt.Schema
					rows := tree.DataRows[schemaSlotID]
					schema := tree.Schemas[schemaSlotID]
					if rows != nil && schema != nil {
						dataText := projectDataRows(rows, schema)
						if dataText != "" {
							childTexts = append(childTexts, dataText)
						}
					}
				}
			}
		}

		return strings.Join(childTexts, "\n")

	case NodeInput:
		if node.Props.Value != nil {
			return indent + *node.Props.Value
		}
		if node.Props.Placeholder != nil {
			return indent + *node.Props.Placeholder
		}
		return indent

	case NodeImage, NodeCanvas:
		if node.Props.AltText != nil {
			return indent + *node.Props.AltText
		}
		return indent + "[image]"

	case NodeSeparator:
		return indent + "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500" // ────────────────

	default:
		return ""
	}
}

// projectDataRows formats data rows as a TSV-like table.
func projectDataRows(rows [][]interface{}, schema []SchemaColumn) string {
	if len(rows) == 0 {
		return ""
	}

	var lines []string

	// Header
	headers := make([]string, len(schema))
	for i, col := range schema {
		headers[i] = col.Name
	}
	lines = append(lines, strings.Join(headers, "\t"))

	// Data rows
	for _, row := range rows {
		cells := make([]string, len(schema))
		for i, col := range schema {
			if i < len(row) {
				cells[i] = formatValue(row[i], col)
			} else {
				cells[i] = ""
			}
		}
		lines = append(lines, strings.Join(cells, "\t"))
	}

	return strings.Join(lines, "\n")
}

// formatValue formats a single data value for text projection.
func formatValue(value interface{}, column SchemaColumn) string {
	if value == nil {
		return ""
	}

	if column.Format == "human_bytes" {
		if n, ok := toFloat(value); ok {
			return humanBytes(n)
		}
	}

	if column.Format == "relative_time" {
		if n, ok := toFloat(value); ok {
			return relativeTime(n)
		}
	}

	return fmt.Sprintf("%v", value)
}

// humanBytes formats a byte count into a human-readable string.
func humanBytes(bytes float64) string {
	units := []string{"B", "KB", "MB", "GB", "TB"}
	i := 0
	b := bytes
	for b >= 1024 && i < len(units)-1 {
		b /= 1024
		i++
	}
	if i == 0 {
		return fmt.Sprintf("%.0f %s", b, units[i])
	}
	return fmt.Sprintf("%.1f %s", b, units[i])
}

// relativeTime formats a Unix timestamp as a relative time string.
func relativeTime(timestamp float64) string {
	now := float64(time.Now().Unix())
	diff := now - timestamp
	if diff < 0 {
		diff = math.Abs(diff)
	}
	if diff < 60 {
		return "just now"
	}
	if diff < 3600 {
		return fmt.Sprintf("%dm ago", int(diff/60))
	}
	if diff < 86400 {
		return fmt.Sprintf("%dh ago", int(diff/3600))
	}
	return fmt.Sprintf("%dd ago", int(diff/86400))
}
