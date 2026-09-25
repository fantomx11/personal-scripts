#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import gi

gi.require_version('Gimp', '3.0')
gi.require_version('GimpUi', '3.0')
gi.require_version('Gegl', '0.4')
from gi.repository import Gimp, GimpUi, Gegl, GObject, GLib


class IndexSingleLayer(Gimp.PlugIn):

    def do_query_procedures(self):
        return ["python-fu-index-single-layer"]

    def do_create_procedure(self, name):
        procedure = Gimp.ImageProcedure.new(
            self,
            name,
            Gimp.PDBProcType.PLUGIN,
            self.run,
            None
        )

        # Accept "*" so GIMP does not abort when GroupLayer items are selected
        procedure.set_image_types("*")
        procedure.set_sensitivity_mask(
            Gimp.ProcedureSensitivityMask.DRAWABLE | Gimp.ProcedureSensitivityMask.DRAWABLES
        )
        procedure.set_menu_label("Index Selected Layers / Groups")
        procedure.add_menu_path("<Image>/Layer")

        procedure.set_documentation(
            "Quantize selected layers and layer groups to an indexed palette",
            "Quantizes raster layers either individually or with all layers in a group sharing a single palette.",
            name
        )
        procedure.set_attribution("User", "GPL", "2026")

        procedure.add_int_argument(
            "num-colors",
            "Max Colors",
            "Max Colors (1-256)",
            1, 256, 256,
            GObject.ParamFlags.READWRITE
        )

        dither_choice = Gimp.Choice.new()
        dither_choice.add("none", int(Gimp.ConvertDitherType.NONE), "No Dithering", "Disable color dithering")
        dither_choice.add("fs", int(Gimp.ConvertDitherType.FS), "Floyd-Steinberg (Standard)", "Normal error diffusion dithering")
        dither_choice.add("fs-lowbleed", int(Gimp.ConvertDitherType.FS_LOWBLEED), "Floyd-Steinberg (Reduced Bleed)", "Reduced color bleeding")
        dither_choice.add("fixed", int(Gimp.ConvertDitherType.FIXED), "Positioned / Patterned", "Fixed position dithering")

        procedure.add_choice_argument(
            "dither-type",
            "Color Dithering",
            "Color dithering type",
            dither_choice,
            "none",
            GObject.ParamFlags.READWRITE
        )
        procedure.add_enum_argument(
            "palette-type",
            "Palette",
            "Palette type",
            Gimp.ConvertPaletteType,
            Gimp.ConvertPaletteType.GENERATE,
            GObject.ParamFlags.READWRITE
        )
        procedure.add_boolean_argument(
            "alpha-dither",
            "Dither transparency",
            "Dither transparency",
            False,
            GObject.ParamFlags.READWRITE
        )
        procedure.add_boolean_argument(
            "remove-unused",
            "Remove unused colors",
            "Remove unused colors from the palette",
            True,
            GObject.ParamFlags.READWRITE
        )
        procedure.add_palette_argument(
            "custom-palette",
            "Custom Palette",
            "Custom Palette (if Custom selected)",
            True,
            None,
            False,
            GObject.ParamFlags.READWRITE
        )
        procedure.add_boolean_argument(
            "replace-original",
            "Replace original layer(s)",
            "Replace original layers instead of creating new copies",
            False,
            GObject.ParamFlags.READWRITE
        )
        procedure.add_boolean_argument(
            "group-shared-palette",
            "Share palette within groups",
            "Generate a single shared palette for all layers in each group",
            True,
            GObject.ParamFlags.READWRITE
        )

        return procedure

    def _collect_layers(self, drawables):
        """Recursively collect all raster layers from a list of items."""
        collected = []
        seen_ids = set()

        def _traverse(items):
            for item in items:
                if item.is_group():
                    _traverse(item.get_children())
                elif isinstance(item, Gimp.Layer):
                    item_id = item.get_id()
                    if item_id not in seen_ids:
                        seen_ids.add(item_id)
                        collected.append(item)

        _traverse(drawables)
        return collected

    def _get_offsets(self, layer):
        """Safely unpack layer offsets across GIMP 3 typelib variants."""
        offsets = layer.get_offsets()
        return (offsets[-2], offsets[-1])

    def _build_batches(self, drawables, group_shared_palette):
        """
        Organize layers into processing batches.
        - If group_shared_palette is True: layers in the same group form one batch.
        - If group_shared_palette is False: every layer is an independent batch.
        """
        if not group_shared_palette:
            all_layers = self._collect_layers(drawables)
            return [[layer] for layer in all_layers]

        batches = []
        seen_ids = set()

        # 1. Process explicitly selected GroupLayer items
        for item in drawables:
            if item.is_group():
                group_layers = []
                for lyr in self._collect_layers([item]):
                    if lyr.get_id() not in seen_ids:
                        seen_ids.add(lyr.get_id())
                        group_layers.append(lyr)
                if group_layers:
                    batches.append(group_layers)

        # 2. Process individually selected layers (grouping siblings by parent group)
        parent_map = {}
        for item in drawables:
            if isinstance(item, Gimp.Layer) and not item.is_group():
                if item.get_id() in seen_ids:
                    continue
                seen_ids.add(item.get_id())
                parent = item.get_parent()
                if parent is not None:
                    parent_id = parent.get_id()
                    if parent_id not in parent_map:
                        parent_map[parent_id] = []
                    parent_map[parent_id].append(item)
                else:
                    # Root layer (outside any group)
                    batches.append([item])

        for grouped_layers in parent_map.values():
            batches.append(grouped_layers)

        return batches

    def run(self, procedure, run_mode, image, drawables, config, run_data):
        if image.get_base_type() == Gimp.ImageBaseType.INDEXED:
            return procedure.new_return_values(
                Gimp.PDBStatusType.CALLING_ERROR,
                GLib.Error("Image is already indexed. This plug-in is for RGB or Grayscale images.")
            )

        # Show GUI dialog in interactive mode
        if run_mode == Gimp.RunMode.INTERACTIVE:
            GimpUi.init("python-fu-index-single-layer")
            dialog = GimpUi.ProcedureDialog.new(procedure, config, "Index Selected Layers")
            dialog.fill(None)
            if not dialog.run():
                dialog.destroy()
                return procedure.new_return_values(Gimp.PDBStatusType.CANCEL, None)
            dialog.destroy()

        # Retrieve settings from config
        num_colors = config.get_property("num-colors")
        dither_nick = config.get_property("dither-type")
        palette_type = config.get_property("palette-type")
        alpha_dither = config.get_property("alpha-dither")
        remove_unused = config.get_property("remove-unused")
        custom_palette = config.get_property("custom-palette")
        replace_original = config.get_property("replace-original")
        group_shared_palette = config.get_property("group-shared-palette")

        dither_map = {
            "none": Gimp.ConvertDitherType.NONE,
            "fs": Gimp.ConvertDitherType.FS,
            "fs-lowbleed": Gimp.ConvertDitherType.FS_LOWBLEED,
            "fixed": Gimp.ConvertDitherType.FIXED,
        }
        dither_type = dither_map.get(dither_nick, Gimp.ConvertDitherType.NONE)

        palette_name = ""
        if custom_palette:
            if hasattr(custom_palette, "get_name"):
                palette_name = custom_palette.get_name()
            elif isinstance(custom_palette, str):
                palette_name = custom_palette

        batches = self._build_batches(drawables, group_shared_palette)
        if not batches:
            return procedure.new_return_values(
                Gimp.PDBStatusType.CALLING_ERROR,
                GLib.Error("No valid raster layers found in the selection.")
            )

        is_gray = (image.get_base_type() == Gimp.ImageBaseType.GRAY)
        temp_base_type = Gimp.ImageBaseType.GRAY if is_gray else Gimp.ImageBaseType.RGB

        new_layers = []
        image.undo_group_start()

        try:
            for batch in batches:
                temp_image = None
                try:
                    # Determine collective bounding box for the entire batch
                    layer_offsets = [self._get_offsets(l) for l in batch]
                    min_x = min(ox for ox, _ in layer_offsets)
                    min_y = min(oy for _, oy in layer_offsets)
                    max_x = max(ox + l.get_width() for (ox, _), l in zip(layer_offsets, batch))
                    max_y = max(oy + l.get_height() for (_, oy), l in zip(layer_offsets, batch))

                    temp_w = max(1, max_x - min_x)
                    temp_h = max(1, max_y - min_y)

                    temp_image = Gimp.Image.new(temp_w, temp_h, temp_base_type)

                    # Copy batch layers into temporary canvas, preserving relative positions
                    temp_layer_pairs = []
                    for orig_layer, (ox, oy) in zip(batch, layer_offsets):
                        temp_layer = Gimp.Layer.new_from_drawable(orig_layer, temp_image)
                        temp_image.insert_layer(temp_layer, None, -1)
                        temp_layer.set_offsets(ox - min_x, oy - min_y)
                        temp_layer_pairs.append((orig_layer, temp_layer))

                    # Quantize all layers in temp_image against one shared palette
                    temp_image.convert_indexed(
                        dither_type,
                        palette_type,
                        num_colors,
                        alpha_dither,
                        remove_unused,
                        palette_name
                    )

                    # Return temporary canvas to RGB/Gray for extraction
                    if is_gray:
                        temp_image.convert_grayscale()
                    else:
                        temp_image.convert_rgb()

                    # Move quantized layers back into the original image
                    for orig_layer, temp_layer in temp_layer_pairs:
                        new_layer = Gimp.Layer.new_from_drawable(temp_layer, image)

                        if replace_original:
                            new_layer.set_name(orig_layer.get_name())
                        else:
                            new_layer.set_name(f"{orig_layer.get_name()} (Indexed)")

                        off_x, off_y = self._get_offsets(orig_layer)
                        new_layer.set_offsets(off_x, off_y)
                        new_layer.set_opacity(orig_layer.get_opacity())
                        new_layer.set_mode(orig_layer.get_mode())
                        new_layer.set_visible(orig_layer.get_visible())

                        parent_group = orig_layer.get_parent()
                        position = image.get_item_position(orig_layer)

                        if replace_original:
                            image.remove_layer(orig_layer)

                        image.insert_layer(new_layer, parent_group, position)
                        new_layers.append(new_layer)

                finally:
                    if temp_image is not None:
                        temp_image.delete()

            if new_layers:
                image.set_selected_layers(new_layers)

            Gimp.displays_flush()

        except Exception as err:
            return procedure.new_return_values(
                Gimp.PDBStatusType.EXECUTION_ERROR,
                GLib.Error(str(err))
            )
        finally:
            image.undo_group_end()

        return procedure.new_return_values(Gimp.PDBStatusType.SUCCESS, None)


if __name__ == "__main__":
    Gimp.main(IndexSingleLayer.__gtype__, sys.argv)