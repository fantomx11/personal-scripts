bl_info = {
    "name": "Modular 3D Decimator",
    "author": "Custom",
    "version": (1, 2, 1),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar (N) > Terrain",
    "description": "3D Bounding Box Decimator with Full Native Cleanup Pipeline",
    "category": "Mesh",
}

import bpy

def build_node_tree():
    # =========================================================================
    # 1. SUB-GROUP: OnBoundingBox
    # =========================================================================
    sub_tree_name = "OnBoundingBox"
    sub_tree = bpy.data.node_groups.get(sub_tree_name) or bpy.data.node_groups.new(sub_tree_name, 'GeometryNodeTree')
    sub_tree.nodes.clear()

    # Clear old sockets to prevent duplicate accumulation on multiple runs
    if hasattr(sub_tree, "interface"):
        sub_tree.interface.clear()
        sub_tree.interface.new_socket("Min", in_out='INPUT', socket_type='NodeSocketFloat')
        sub_tree.interface.new_socket("Max", in_out='INPUT', socket_type='NodeSocketFloat')
        sub_tree.interface.new_socket("Value", in_out='INPUT', socket_type='NodeSocketFloat')
        sub_tree.interface.new_socket("Epsilon", in_out='INPUT', socket_type='NodeSocketFloat')
        sub_tree.interface.new_socket("On Face", in_out='OUTPUT', socket_type='NodeSocketBool')
    else:
        sub_tree.inputs.clear()
        sub_tree.outputs.clear()
        sub_tree.inputs.new('NodeSocketFloat', 'Min')
        sub_tree.inputs.new('NodeSocketFloat', 'Max')
        sub_tree.inputs.new('NodeSocketFloat', 'Value')
        sub_tree.inputs.new('NodeSocketFloat', 'Epsilon')
        sub_tree.outputs.new('NodeSocketBool', 'On Face')

    sub_in = sub_tree.nodes.new('NodeGroupInput')
    sub_out = sub_tree.nodes.new('NodeGroupOutput')
    cmp_min = sub_tree.nodes.new('ShaderNodeMath')
    cmp_min.operation = 'COMPARE'
    cmp_max = sub_tree.nodes.new('ShaderNodeMath')
    cmp_max.operation = 'COMPARE'
    or_node = sub_tree.nodes.new('FunctionNodeBooleanMath')
    or_node.operation = 'OR'

    sub_in.location = (-300, 0)
    cmp_min.location = (-50, 100)
    cmp_max.location = (-50, -100)
    or_node.location = (180, 0)
    sub_out.location = (400, 0)

    sub_tree.links.new(sub_in.outputs['Value'], cmp_min.inputs[0])
    sub_tree.links.new(sub_in.outputs['Min'], cmp_min.inputs[1])
    sub_tree.links.new(sub_in.outputs['Epsilon'], cmp_min.inputs[2])
    sub_tree.links.new(sub_in.outputs['Value'], cmp_max.inputs[0])
    sub_tree.links.new(sub_in.outputs['Max'], cmp_max.inputs[1])
    sub_tree.links.new(sub_in.outputs['Epsilon'], cmp_max.inputs[2])
    sub_tree.links.new(cmp_min.outputs[0], or_node.inputs[0])
    sub_tree.links.new(cmp_max.outputs[0], or_node.inputs[1])
    sub_tree.links.new(or_node.outputs[0], sub_out.inputs['On Face'])

    # =========================================================================
    # 2. MAIN MODIFIER TREE
    # =========================================================================
    tree_name = "Modular3DDecimatorWithCleanup"
    main_tree = bpy.data.node_groups.get(tree_name) or bpy.data.node_groups.new(tree_name, 'GeometryNodeTree')
    
    if hasattr(main_tree, "is_modifier"):
        main_tree.is_modifier = True
    main_tree.use_fake_user = True
    main_tree.nodes.clear()

    if hasattr(main_tree, "interface"):
        main_tree.interface.clear()
        main_tree.interface.new_socket("Geometry", in_out='INPUT', socket_type='NodeSocketGeometry')
        s_tol = main_tree.interface.new_socket("Tolerance", in_out='INPUT', socket_type='NodeSocketFloat')
        s_tol.default_value = 0.001
        s_dst = main_tree.interface.new_socket("Merge Distance", in_out='INPUT', socket_type='NodeSocketFloat')
        s_dst.default_value = 0.5
        main_tree.interface.new_socket("Geometry", in_out='OUTPUT', socket_type='NodeSocketGeometry')
    else:
        main_tree.inputs.clear()
        main_tree.outputs.clear()
        main_tree.inputs.new('NodeSocketGeometry', 'Geometry')
        s_tol = main_tree.inputs.new('NodeSocketFloat', 'Tolerance')
        s_tol.default_value = 0.001
        s_dst = main_tree.inputs.new('NodeSocketFloat', 'Merge Distance')
        s_dst.default_value = 0.5
        main_tree.outputs.new('NodeSocketGeometry', 'Geometry')

    # Core Input & Boundary Nodes
    gin = main_tree.nodes.new('NodeGroupInput')
    gout = main_tree.nodes.new('NodeGroupOutput')
    pos = main_tree.nodes.new('GeometryNodeInputPosition')
    bbox = main_tree.nodes.new('GeometryNodeBoundBox')
    
    sep_pos = main_tree.nodes.new('ShaderNodeSeparateXYZ')
    sep_min = main_tree.nodes.new('ShaderNodeSeparateXYZ')
    sep_max = main_tree.nodes.new('ShaderNodeSeparateXYZ')

    grp_x = main_tree.nodes.new('GeometryNodeGroup')
    grp_x.node_tree = sub_tree
    grp_y = main_tree.nodes.new('GeometryNodeGroup')
    grp_y.node_tree = sub_tree
    grp_z = main_tree.nodes.new('GeometryNodeGroup')
    grp_z.node_tree = sub_tree

    prox = main_tree.nodes.new('GeometryNodeProximity')
    prox.target_element = 'FACES'
    is_int = main_tree.nodes.new('ShaderNodeMath')
    is_int.operation = 'GREATER_THAN'

    # Boundary Intersection Checks
    and_xy = main_tree.nodes.new('FunctionNodeBooleanMath')
    and_xy.operation = 'AND'
    and_xz = main_tree.nodes.new('FunctionNodeBooleanMath')
    and_xz.operation = 'AND'
    and_yz = main_tree.nodes.new('FunctionNodeBooleanMath')
    and_yz.operation = 'AND'

    or_edge1 = main_tree.nodes.new('FunctionNodeBooleanMath')
    or_edge1.operation = 'OR'
    or_edge2 = main_tree.nodes.new('FunctionNodeBooleanMath')
    or_edge2.operation = 'OR'
    not_shared = main_tree.nodes.new('FunctionNodeBooleanMath')
    not_shared.operation = 'NOT'

    pure_x = main_tree.nodes.new('FunctionNodeBooleanMath')
    pure_x.operation = 'AND'
    pure_y = main_tree.nodes.new('FunctionNodeBooleanMath')
    pure_y.operation = 'AND'
    pure_z = main_tree.nodes.new('FunctionNodeBooleanMath')
    pure_z.operation = 'AND'

    # 4-Pass Merge
    m_int = main_tree.nodes.new('GeometryNodeMergeByDistance')
    m_int.mode = 'CONNECTED'
    m_x = main_tree.nodes.new('GeometryNodeMergeByDistance')
    m_x.mode = 'CONNECTED'
    m_y = main_tree.nodes.new('GeometryNodeMergeByDistance')
    m_y.mode = 'CONNECTED'
    m_z = main_tree.nodes.new('GeometryNodeMergeByDistance')
    m_z.mode = 'CONNECTED'

# =========================================================================
    # CLEANUP NODES (Robust Boundary-Ratio Pipeline)
    # =========================================================================
    # 1. Zero-Area Faces
    face_area = main_tree.nodes.new('GeometryNodeInputMeshFaceArea')
    cmp_area = main_tree.nodes.new('ShaderNodeMath')
    cmp_area.operation = 'LESS_THAN'
    cmp_area.inputs[1].default_value = 0.0001
    del_faces = main_tree.nodes.new('GeometryNodeDeleteGeometry')
    del_faces.domain = 'FACE'

    # 2. Zero-Length Edges (Run first so collapsed geometry doesn't create new ears)
    edge_verts = main_tree.nodes.new('GeometryNodeInputMeshEdgeVertices')
    vec_dist = main_tree.nodes.new('ShaderNodeVectorMath')
    vec_dist.operation = 'DISTANCE'
    cmp_len = main_tree.nodes.new('ShaderNodeMath')
    cmp_len.operation = 'LESS_THAN'
    cmp_len.inputs[1].default_value = 0.0001
    del_edges = main_tree.nodes.new('GeometryNodeDeleteGeometry')
    del_edges.domain = 'EDGE'

    # 3. Ear / Fin Detection (Boundary Edge Ratio > 0.6)
    edge_nbrs_ear = main_tree.nodes.new('GeometryNodeInputMeshEdgeNeighbors')
    cmp_is_bnd = main_tree.nodes.new('ShaderNodeMath')
    cmp_is_bnd.operation = 'LESS_THAN'
    cmp_is_bnd.inputs[1].default_value = 1.5

    eval_edge_bnd = main_tree.nodes.new('GeometryNodeFieldOnDomain')
    eval_edge_bnd.data_type = 'FLOAT'
    eval_edge_bnd.domain = 'EDGE'

    cmp_ear_ratio = main_tree.nodes.new('ShaderNodeMath')
    cmp_ear_ratio.operation = 'GREATER_THAN'
    cmp_ear_ratio.inputs[1].default_value = 0.6

    # 2-Pass Cascade to catch multi-triangle fins
    del_ears_1 = main_tree.nodes.new('GeometryNodeDeleteGeometry')
    del_ears_1.domain = 'FACE'
    del_ears_2 = main_tree.nodes.new('GeometryNodeDeleteGeometry')
    del_ears_2.domain = 'FACE'

    # 4. Loose Wire Edges
    edge_nbrs_wire = main_tree.nodes.new('GeometryNodeInputMeshEdgeNeighbors')
    cmp_wire = main_tree.nodes.new('ShaderNodeMath')
    cmp_wire.operation = 'LESS_THAN'
    cmp_wire.inputs[1].default_value = 0.5
    del_wires = main_tree.nodes.new('GeometryNodeDeleteGeometry')
    del_wires.domain = 'EDGE'

    # 5. Loose Orphan Vertices
    vert_nbrs = main_tree.nodes.new('GeometryNodeInputMeshVertexNeighbors')
    cmp_vert = main_tree.nodes.new('ShaderNodeMath')
    cmp_vert.operation = 'LESS_THAN'
    cmp_vert.inputs[1].default_value = 0.5
    del_verts = main_tree.nodes.new('GeometryNodeDeleteGeometry')
    del_verts.domain = 'POINT'

    # =========================================================================
    # VISUAL LAYOUT
    # =========================================================================
    gin.location = (-1400, 200)
    pos.location = (-1400, -200)
    bbox.location = (-1150, 400)
    sep_pos.location = (-1150, -200)
    prox.location = (-900, 500)
    sep_min.location = (-900, 100)
    sep_max.location = (-900, -50)
    is_int.location = (-650, 500)

    grp_x.location = (-650, 200)
    grp_y.location = (-650, 50)
    grp_z.location = (-650, -100)

    and_xy.location = (-400, 200)
    and_xz.location = (-400, 50)
    and_yz.location = (-400, -100)
    or_edge1.location = (-200, 150)
    or_edge2.location = (-50, 100)
    not_shared.location = (100, 100)

    pure_x.location = (250, 200)
    pure_y.location = (250, 50)
    pure_z.location = (250, -100)

    m_int.location = (450, 400)
    m_x.location = (650, 400)
    m_y.location = (850, 400)
    m_z.location = (1050, 400)

    face_area.location = (1250, 200)
    cmp_area.location = (1250, 50)
    del_faces.location = (1250, 400)

    edge_verts.location = (1450, 200)
    vec_dist.location = (1450, 50)
    cmp_len.location = (1450, -100)
    del_edges.location = (1450, 400)

    edge_nbrs_ear.location = (1650, 200)
    cmp_is_bnd.location = (1650, 50)
    eval_edge_bnd.location = (1650, -100)
    cmp_ear_ratio.location = (1650, -250)
    del_ears_1.location = (1650, 400)
    del_ears_2.location = (1850, 400)

    edge_nbrs_wire.location = (2050, 200)
    cmp_wire.location = (2050, 50)
    del_wires.location = (2050, 400)

    vert_nbrs.location = (2250, 200)
    cmp_vert.location = (2250, 50)
    del_verts.location = (2250, 400)

    gout.location = (2450, 400)

    # =========================================================================
    # WIRING
    # =========================================================================
    main_tree.links.new(gin.outputs['Geometry'], bbox.inputs['Geometry'])
    main_tree.links.new(bbox.outputs['Bounding Box'], prox.inputs['Target'])
    main_tree.links.new(pos.outputs['Position'], prox.inputs['Sample Position'])
    main_tree.links.new(prox.outputs['Distance'], is_int.inputs[0])
    main_tree.links.new(gin.outputs['Tolerance'], is_int.inputs[1])

    main_tree.links.new(pos.outputs['Position'], sep_pos.inputs['Vector'])
    main_tree.links.new(bbox.outputs['Min'], sep_min.inputs['Vector'])
    main_tree.links.new(bbox.outputs['Max'], sep_max.inputs['Vector'])

    for axis, grp in [('X', grp_x), ('Y', grp_y), ('Z', grp_z)]:
        main_tree.links.new(sep_min.outputs[axis], grp.inputs['Min'])
        main_tree.links.new(sep_max.outputs[axis], grp.inputs['Max'])
        main_tree.links.new(sep_pos.outputs[axis], grp.inputs['Value'])
        main_tree.links.new(gin.outputs['Tolerance'], grp.inputs['Epsilon'])

    main_tree.links.new(grp_x.outputs['On Face'], and_xy.inputs[0])
    main_tree.links.new(grp_y.outputs['On Face'], and_xy.inputs[1])
    main_tree.links.new(grp_x.outputs['On Face'], and_xz.inputs[0])
    main_tree.links.new(grp_z.outputs['On Face'], and_xz.inputs[1])
    main_tree.links.new(grp_y.outputs['On Face'], and_yz.inputs[0])
    main_tree.links.new(grp_z.outputs['On Face'], and_yz.inputs[1])

    main_tree.links.new(and_xy.outputs[0], or_edge1.inputs[0])
    main_tree.links.new(and_xz.outputs[0], or_edge1.inputs[1])
    main_tree.links.new(or_edge1.outputs[0], or_edge2.inputs[0])
    main_tree.links.new(and_yz.outputs[0], or_edge2.inputs[1])
    main_tree.links.new(or_edge2.outputs[0], not_shared.inputs[0])

    main_tree.links.new(grp_x.outputs['On Face'], pure_x.inputs[0])
    main_tree.links.new(not_shared.outputs[0], pure_x.inputs[1])
    main_tree.links.new(grp_y.outputs['On Face'], pure_y.inputs[0])
    main_tree.links.new(not_shared.outputs[0], pure_y.inputs[1])
    main_tree.links.new(grp_z.outputs['On Face'], pure_z.inputs[0])
    main_tree.links.new(not_shared.outputs[0], pure_z.inputs[1])

    # Merge Passes
    main_tree.links.new(gin.outputs['Geometry'], m_int.inputs['Geometry'])
    main_tree.links.new(is_int.outputs[0], m_int.inputs['Selection'])
    main_tree.links.new(gin.outputs['Merge Distance'], m_int.inputs['Distance'])

    main_tree.links.new(m_int.outputs['Geometry'], m_x.inputs['Geometry'])
    main_tree.links.new(pure_x.outputs[0], m_x.inputs['Selection'])
    main_tree.links.new(gin.outputs['Merge Distance'], m_x.inputs['Distance'])

    main_tree.links.new(m_x.outputs['Geometry'], m_y.inputs['Geometry'])
    main_tree.links.new(pure_y.outputs[0], m_y.inputs['Selection'])
    main_tree.links.new(gin.outputs['Merge Distance'], m_y.inputs['Distance'])

    main_tree.links.new(m_y.outputs['Geometry'], m_z.inputs['Geometry'])
    main_tree.links.new(pure_z.outputs[0], m_z.inputs['Selection'])
    main_tree.links.new(gin.outputs['Merge Distance'], m_z.inputs['Distance'])

    # Cleanup 1: Zero-Area Faces
    main_tree.links.new(m_z.outputs['Geometry'], del_faces.inputs['Geometry'])
    main_tree.links.new(face_area.outputs['Area'], cmp_area.inputs[0])
    main_tree.links.new(cmp_area.outputs[0], del_faces.inputs['Selection'])

    # Cleanup 2: Zero-Length Edges
    main_tree.links.new(del_faces.outputs['Geometry'], del_edges.inputs['Geometry'])
    main_tree.links.new(edge_verts.outputs['Position 1'], vec_dist.inputs[0])
    main_tree.links.new(edge_verts.outputs['Position 2'], vec_dist.inputs[1])
    main_tree.links.new(vec_dist.outputs['Value'], cmp_len.inputs[0])
    main_tree.links.new(cmp_len.outputs[0], del_edges.inputs['Selection'])

    # Cleanup 3: Ear / Fin Faces (Boundary Edge Ratio Evaluation)
    main_tree.links.new(edge_nbrs_ear.outputs['Face Count'], cmp_is_bnd.inputs[0])
    main_tree.links.new(cmp_is_bnd.outputs[0], eval_edge_bnd.inputs['Value'])
    main_tree.links.new(eval_edge_bnd.outputs['Value'], cmp_ear_ratio.inputs[0])

    # Pass 1
    main_tree.links.new(del_edges.outputs['Geometry'], del_ears_1.inputs['Geometry'])
    main_tree.links.new(cmp_ear_ratio.outputs[0], del_ears_1.inputs['Selection'])

    # Pass 2 (Catches newly exposed ear faces from Pass 1)
    main_tree.links.new(del_ears_1.outputs['Geometry'], del_ears_2.inputs['Geometry'])
    main_tree.links.new(cmp_ear_ratio.outputs[0], del_ears_2.inputs['Selection'])

    # Cleanup 4: Loose Wire Edges
    main_tree.links.new(del_ears_2.outputs['Geometry'], del_wires.inputs['Geometry'])
    main_tree.links.new(edge_nbrs_wire.outputs['Face Count'], cmp_wire.inputs[0])
    main_tree.links.new(cmp_wire.outputs[0], del_wires.inputs['Selection'])

    # Cleanup 5: Loose Orphan Vertices
    main_tree.links.new(del_wires.outputs['Geometry'], del_verts.inputs['Geometry'])
    main_tree.links.new(vert_nbrs.outputs['Vertex Count'], cmp_vert.inputs[0])
    main_tree.links.new(cmp_vert.outputs[0], del_verts.inputs['Selection'])

    # Group Output
    main_tree.links.new(del_verts.outputs['Geometry'], gout.inputs['Geometry'])

    return main_tree

class OBJECT_OT_add_modular_decimator(bpy.types.Operator):
    bl_idname = "object.add_modular_decimator"
    bl_label = "Apply Modular Decimator"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        obj = context.active_object
        if not obj or obj.type != 'MESH':
            self.report({'ERROR'}, "Select a Mesh object first.")
            return {'CANCELLED'}

        tree = build_node_tree()
        mod = obj.modifiers.get("Modular 3D Decimator") or obj.modifiers.new("Modular 3D Decimator", 'NODES')
        mod.node_group = tree
        self.report({'INFO'}, f"Decimator applied to {obj.name}")
        return {'FINISHED'}

class VIEW3D_PT_modular_decimator_panel(bpy.types.Panel):
    bl_label = "Modular Terrain"
    bl_idname = "VIEW3D_PT_modular_decimator_panel"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Terrain'

    def draw(self, context):
        layout = self.layout
        layout.operator("object.add_modular_decimator", icon='MOD_DECIM')

classes = (
    OBJECT_OT_add_modular_decimator,
    VIEW3D_PT_modular_decimator_panel,
)

def register():
    for cls in classes:
        bpy.utils.register_class(cls)

def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)

if __name__ == "__main__":
    register()