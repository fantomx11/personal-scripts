#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import gi

gi.require_version("Gimp", "3.0")
from gi.repository import Gimp

gi.require_version("GimpUi", "3.0")
from gi.repository import GimpUi

gi.require_version("GLib", "2.0")
from gi.repository import GLib

gi.require_version("GObject", "2.0")
from gi.repository import GObject


class SplitLayerToTiles(Gimp.PlugIn):
    def do_query_procedures(self):
        return ["python-fu-split-layer-to-tiles"]

    def do_create_procedure(self, name):
        procedure = Gimp.ImageProcedure.new(
            self,
            name,
            Gimp.PDBProcType.PLUGIN,
            self.run,
            None,
        )

        procedure.set_image_types("RGB*, GRAY*, INDEXED*")
        procedure.set_sensitivity_mask(Gimp.ProcedureSensitivityMask.DRAWABLE)
        procedure.set_menu_label("Split to Tiles...")
        procedure.add_menu_path("<Image>/Layer")

        procedure.set_documentation(
            "Split the active layer into tile layers of a fixed pixel size",
            "Divides the current layer into tiles matching the specified pixel dimensions (e.g. 8x12 px) inside a group.",
            name,
        )
        procedure.set_attribution("Assistant", "Public Domain", "2026")

        procedure.add_int_argument(
            "tile-width",
            "Tile Width (px)",
            "Width of each tile in pixels",
            1,
            10000,
            8,
            GObject.ParamFlags.READWRITE,
        )
        procedure.add_int_argument(
            "tile-height",
            "Tile Height (px)",
            "Height of each tile in pixels",
            1,
            10000,
            12,
            GObject.ParamFlags.READWRITE,
        )
        procedure.add_boolean_argument(
            "replace-original",
            "Replace original layer",
            "Remove the original layer after splitting",
            False,
            GObject.ParamFlags.READWRITE,
        )

        return procedure

    def run(self, procedure, run_mode, image, drawables, config, run_data):
        if not drawables:
            return procedure.new_return_values(
                Gimp.PDBStatusType.CALLING_ERROR,
                GLib.Error("No active layer selected."),
            )

        orig_layer = drawables[0]
        if not isinstance(orig_layer, Gimp.Layer) or orig_layer.is_group():
            return procedure.new_return_values(
                Gimp.PDBStatusType.CALLING_ERROR,
                GLib.Error("Selected drawable must be a raster layer, not a group or mask."),
            )

        # Build dialog in interactive mode
        if run_mode == Gimp.RunMode.INTERACTIVE:
            GimpUi.init("python-fu-split-layer-to-tiles")
            dialog = GimpUi.ProcedureDialog.new(
                procedure, config, "Split Layer to Tiles"
            )
            dialog.fill(None)

            if not dialog.run():
                dialog.destroy()
                return procedure.new_return_values(Gimp.PDBStatusType.CANCEL, None)
            dialog.destroy()

        tile_width = config.get_property("tile-width")
        tile_height = config.get_property("tile-height")
        replace_original = config.get_property("replace-original")

        if tile_width <= 0 or tile_height <= 0:
            return procedure.new_return_values(
                Gimp.PDBStatusType.CALLING_ERROR,
                GLib.Error("Tile width and height must be greater than 0."),
            )

        image.undo_group_start()

        try:
            orig_width = orig_layer.get_width()
            orig_height = orig_layer.get_height()

            orig_offsets = orig_layer.get_offsets()
            orig_x, orig_y = orig_offsets[-2], orig_offsets[-1]

            orig_name = orig_layer.get_name()
            parent = orig_layer.get_parent()
            position = image.get_item_position(orig_layer)

            # Insert the new layer group where the original layer was
            group = Gimp.GroupLayer.new(image)
            group.set_name(f"{orig_name}_tiles_{tile_width}x{tile_height}px")
            image.insert_layer(group, parent, position)

            # Step across the layer in tile-sized increments
            for r, y1 in enumerate(range(0, orig_height, tile_height)):
                for c, x1 in enumerate(range(0, orig_width, tile_width)):
                    # Crop dimensions (handles edge tiles if layer size isn't an exact multiple)
                    w = min(tile_width, orig_width - x1)
                    h = min(tile_height, orig_height - y1)

                    tile = orig_layer.copy()
                    tile.set_name(f"{orig_name}_r{r + 1:02d}_c{c + 1:02d}")

                    # Append into group (-1 appends to bottom to maintain visual stacking order)
                    image.insert_layer(tile, group, -1)

                    # Crop down to the tile bounds and position it on the canvas
                    tile.resize(w, h, -x1, -y1)
                    tile.set_offsets(orig_x + x1, orig_y + y1)

            if replace_original:
                image.remove_layer(orig_layer)

        except Exception as e:
            image.undo_group_end()
            return procedure.new_return_values(
                Gimp.PDBStatusType.EXECUTION_ERROR, GLib.Error(str(e))
            )

        image.undo_group_end()
        Gimp.displays_flush()

        return procedure.new_return_values(Gimp.PDBStatusType.SUCCESS, None)


if __name__ == "__main__":
    Gimp.main(SplitLayerToTiles.__gtype__, sys.argv)