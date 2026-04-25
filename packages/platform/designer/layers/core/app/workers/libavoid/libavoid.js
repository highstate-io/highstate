let wasm;

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

cachedTextDecoder.decode();

const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

export function main() {
    wasm.main();
}

const AvoidLibFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_avoidlib_free(ptr >>> 0, 1));

export class AvoidLib {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(AvoidLib.prototype);
        obj.__wbg_ptr = ptr;
        AvoidLibFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AvoidLibFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_avoidlib_free(ptr, 0);
    }
    /**
     * Get instance (compatibility with libavoid-js)
     * @returns {AvoidLib}
     */
    static getInstance() {
        const ret = wasm.avoidlib_getInstance();
        return AvoidLib.__wrap(ret);
    }
    /**
     * Load the library (compatibility with libavoid-js)
     * In wasm-pack, actual loading is handled by the generated init function
     * @returns {AvoidLib}
     */
    static load() {
        const ret = wasm.avoidlib_getInstance();
        return AvoidLib.__wrap(ret);
    }
}
if (Symbol.dispose) AvoidLib.prototype[Symbol.dispose] = AvoidLib.prototype.free;

const BoxFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_box_free(ptr >>> 0, 1));

export class Box {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Box.prototype);
        obj.__wbg_ptr = ptr;
        BoxFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BoxFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_box_free(ptr, 0);
    }
    /**
     * Create a Box from coordinates
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @returns {Box}
     */
    static fromCoords(x1, y1, x2, y2) {
        const ret = wasm.box_fromCoords(x1, y1, x2, y2);
        return Box.__wrap(ret);
    }
    /**
     * @returns {Point}
     */
    get max() {
        const ret = wasm.box_max(this.__wbg_ptr);
        return Point.__wrap(ret);
    }
    /**
     * @returns {Point}
     */
    get min() {
        const ret = wasm.box_min(this.__wbg_ptr);
        return Point.__wrap(ret);
    }
    constructor() {
        const ret = wasm.box_new();
        this.__wbg_ptr = ret >>> 0;
        BoxFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    width() {
        const ret = wasm.box_width(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    height() {
        const ret = wasm.box_height(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns length along the specified dimension (0 = width, 1 = height)
     * @param {number} dimension
     * @returns {number}
     */
    length(dimension) {
        const ret = wasm.box_length(this.__wbg_ptr, dimension);
        return ret;
    }
    /**
     * @param {Point} point
     */
    set max(point) {
        _assertClass(point, Point);
        wasm.box_set_max(this.__wbg_ptr, point.__wbg_ptr);
    }
    /**
     * @param {Point} point
     */
    set min(point) {
        _assertClass(point, Point);
        wasm.box_set_min(this.__wbg_ptr, point.__wbg_ptr);
    }
    /**
     * Checks if the box contains a point
     * @param {Point} point
     * @returns {boolean}
     */
    contains(point) {
        _assertClass(point, Point);
        const ret = wasm.box_contains(this.__wbg_ptr, point.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) Box.prototype[Symbol.dispose] = Box.prototype.free;

const ConnEndFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_connend_free(ptr >>> 0, 1));

export class ConnEnd {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ConnEnd.prototype);
        obj.__wbg_ptr = ptr;
        ConnEndFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ConnEndFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_connend_free(ptr, 0);
    }
    /**
     * Create a ConnEnd attached to a shape's connection pin class
     * @param {ShapeRef} shape
     * @param {number} pin_class_id
     * @returns {ConnEnd}
     */
    static fromShapePin(shape, pin_class_id) {
        _assertClass(shape, ShapeRef);
        const ret = wasm.connend_fromShapePin(shape.__wbg_ptr, pin_class_id);
        return ConnEnd.__wrap(ret);
    }
    /**
     * @param {Point} point
     * @param {number | null} [directions]
     */
    constructor(point, directions) {
        _assertClass(point, Point);
        const ret = wasm.connend_new(point.__wbg_ptr, isLikeNone(directions) ? 0x100000001 : (directions) >>> 0);
        this.__wbg_ptr = ret >>> 0;
        ConnEndFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) ConnEnd.prototype[Symbol.dispose] = ConnEnd.prototype.free;

const ConnRefFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_connref_free(ptr >>> 0, 1));

export class ConnRef {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ConnRef.prototype);
        obj.__wbg_ptr = ptr;
        ConnRefFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ConnRefFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_connref_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    routingType() {
        const ret = wasm.connref_routingType(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {any} _callback
     * @param {any} _context
     */
    setCallback(_callback, _context) {
        wasm.connref_setCallback(this.__wbg_ptr, _callback, _context);
    }
    /**
     * @returns {Polygon | undefined}
     */
    displayRoute() {
        const ret = wasm.connref_displayRoute(this.__wbg_ptr);
        return ret === 0 ? undefined : Polygon.__wrap(ret);
    }
    /**
     * Create a ConnRef with endpoints and a specific ID
     * @param {Router} router
     * @param {ConnEnd} src
     * @param {ConnEnd} dst
     * @param {number} id
     * @returns {ConnRef}
     */
    static createWithId(router, src, dst, id) {
        _assertClass(router, Router);
        _assertClass(src, ConnEnd);
        _assertClass(dst, ConnEnd);
        const ret = wasm.connref_createWithId(router.__wbg_ptr, src.__wbg_ptr, dst.__wbg_ptr, id);
        return ConnRef.__wrap(ret);
    }
    /**
     * @param {number} routing_type
     */
    setRoutingType(routing_type) {
        wasm.connref_setRoutingType(this.__wbg_ptr, routing_type);
    }
    /**
     * @param {ConnEnd} conn_end
     */
    setDestEndpoint(conn_end) {
        _assertClass(conn_end, ConnEnd);
        wasm.connref_setDestEndpoint(this.__wbg_ptr, conn_end.__wbg_ptr);
    }
    /**
     * Set whether this connector hates crossings
     * @param {boolean} value
     */
    setHateCrossings(value) {
        wasm.connref_setHateCrossings(this.__wbg_ptr, value);
    }
    /**
     * Check if this connector hates crossings
     * @returns {boolean}
     */
    doesHateCrossings() {
        const ret = wasm.connref_doesHateCrossings(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {ConnEnd} conn_end
     */
    setSourceEndpoint(conn_end) {
        _assertClass(conn_end, ConnEnd);
        wasm.connref_setSourceEndpoint(this.__wbg_ptr, conn_end.__wbg_ptr);
    }
    /**
     * Create a ConnRef with source and destination endpoints
     * @param {Router} router
     * @param {ConnEnd} src
     * @param {ConnEnd} dst
     * @returns {ConnRef}
     */
    static createWithEndpoints(router, src, dst) {
        _assertClass(router, Router);
        _assertClass(src, ConnEnd);
        _assertClass(dst, ConnEnd);
        const ret = wasm.connref_createWithEndpoints(router.__wbg_ptr, src.__wbg_ptr, dst.__wbg_ptr);
        return ConnRef.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    id() {
        const ret = wasm.connref_id(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {Router} router
     */
    constructor(router) {
        _assertClass(router, Router);
        const ret = wasm.connref_new(router.__wbg_ptr);
        this.__wbg_ptr = ret >>> 0;
        ConnRefFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) ConnRef.prototype[Symbol.dispose] = ConnRef.prototype.free;

const HyperedgeRerouterFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_hyperedgererouter_free(ptr >>> 0, 1));

export class HyperedgeRerouter {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        HyperedgeRerouterFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_hyperedgererouter_free(ptr, 0);
    }
    /**
     * Register a hyperedge for rerouting based on a junction
     * Returns the index/ID of the registered hyperedge
     * @param {JunctionRef} junction
     * @returns {number}
     */
    registerHyperedgeForRerouting(junction) {
        _assertClass(junction, JunctionRef);
        const ret = wasm.hyperedgererouter_registerHyperedgeForRerouting(this.__wbg_ptr, junction.__wbg_ptr);
        return ret >>> 0;
    }
    constructor() {
        const ret = wasm.hyperedgererouter_new();
        this.__wbg_ptr = ret >>> 0;
        HyperedgeRerouterFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) HyperedgeRerouter.prototype[Symbol.dispose] = HyperedgeRerouter.prototype.free;

const JunctionRefFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_junctionref_free(ptr >>> 0, 1));

export class JunctionRef {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(JunctionRef.prototype);
        obj.__wbg_ptr = ptr;
        JunctionRefFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        JunctionRefFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_junctionref_free(ptr, 0);
    }
    /**
     * Sets the junction's position
     * @param {Point} position
     */
    setPosition(position) {
        _assertClass(position, Point);
        wasm.junctionref_setPosition(this.__wbg_ptr, position.__wbg_ptr);
    }
    /**
     * Create a JunctionRef with a specific ID
     * @param {Router} _router
     * @param {Point} position
     * @param {number} id
     * @returns {JunctionRef}
     */
    static createWithId(_router, position, id) {
        _assertClass(_router, Router);
        _assertClass(position, Point);
        const ret = wasm.junctionref_createWithId(_router.__wbg_ptr, position.__wbg_ptr, id);
        return JunctionRef.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    id() {
        const ret = wasm.junctionref_id(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {Router} router
     * @param {Point} position
     */
    constructor(router, position) {
        _assertClass(router, Router);
        _assertClass(position, Point);
        const ret = wasm.junctionref_new(router.__wbg_ptr, position.__wbg_ptr);
        this.__wbg_ptr = ret >>> 0;
        JunctionRefFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Returns the junction's position
     * @returns {Point}
     */
    position() {
        const ret = wasm.junctionref_position(this.__wbg_ptr);
        return Point.__wrap(ret);
    }
}
if (Symbol.dispose) JunctionRef.prototype[Symbol.dispose] = JunctionRef.prototype.free;

const PointFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_point_free(ptr >>> 0, 1));

export class Point {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Point.prototype);
        obj.__wbg_ptr = ptr;
        PointFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PointFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_point_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get x() {
        const ret = wasm.point_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get y() {
        const ret = wasm.point_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get id() {
        const ret = wasm.point_id(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get vn() {
        const ret = wasm.point_vn(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} x
     * @param {number} y
     */
    constructor(x, y) {
        const ret = wasm.point_new(x, y);
        this.__wbg_ptr = ret >>> 0;
        PointFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Check equality with another point
     * @param {Point} other
     * @returns {boolean}
     */
    equal(other) {
        _assertClass(other, Point);
        const ret = wasm.point_equal(this.__wbg_ptr, other.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} x
     */
    set x(x) {
        wasm.point_set_x(this.__wbg_ptr, x);
    }
    /**
     * @param {number} y
     */
    set y(y) {
        wasm.point_set_y(this.__wbg_ptr, y);
    }
    /**
     * Create a Point at origin (0, 0)
     * @returns {Point}
     */
    static origin() {
        const ret = wasm.point_origin();
        return Point.__wrap(ret);
    }
    /**
     * @param {number} id
     */
    set id(id) {
        wasm.point_set_id(this.__wbg_ptr, id);
    }
    /**
     * @param {number} vn
     */
    set vn(vn) {
        wasm.point_set_vn(this.__wbg_ptr, vn);
    }
}
if (Symbol.dispose) Point.prototype[Symbol.dispose] = Point.prototype.free;

const PolygonFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_polygon_free(ptr >>> 0, 1));

export class Polygon {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Polygon.prototype);
        obj.__wbg_ptr = ptr;
        PolygonFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PolygonFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_polygon_free(ptr, 0);
    }
    /**
     * Returns an offset polygon
     * @param {number} offset
     * @returns {Polygon}
     */
    offsetPolygon(offset) {
        const ret = wasm.polygon_offsetPolygon(this.__wbg_ptr, offset);
        return Polygon.__wrap(ret);
    }
    /**
     * Returns the bounding box offset by the given amount
     * @param {number} offset
     * @returns {Box}
     */
    offsetBoundingBox(offset) {
        const ret = wasm.polygon_offsetBoundingBox(this.__wbg_ptr, offset);
        return Box.__wrap(ret);
    }
    /**
     * Returns the bounding rectangle as a polygon
     * @returns {Polygon}
     */
    boundingRectPolygon() {
        const ret = wasm.polygon_boundingRectPolygon(this.__wbg_ptr);
        return Polygon.__wrap(ret);
    }
    /**
     * @param {number} index
     * @returns {Point | undefined}
     */
    at(index) {
        const ret = wasm.polygon_at(this.__wbg_ptr, index);
        return ret === 0 ? undefined : Point.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    id() {
        const ret = wasm.point_vn(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} vertex_count
     */
    constructor(vertex_count) {
        const ret = wasm.polygon_new(vertex_count);
        this.__wbg_ptr = ret >>> 0;
        PolygonFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    size() {
        const ret = wasm.polygon_size(this.__wbg_ptr);
        return ret >>> 0;
    }
    clear() {
        wasm.polygon_clear(this.__wbg_ptr);
    }
    /**
     * @returns {boolean}
     */
    empty() {
        const ret = wasm.polygon_empty(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} index
     * @returns {Point | undefined}
     */
    get_ps(index) {
        const ret = wasm.polygon_at(this.__wbg_ptr, index);
        return ret === 0 ? undefined : Point.__wrap(ret);
    }
    /**
     * @param {number} index
     * @param {Point} point
     */
    set_ps(index, point) {
        _assertClass(point, Point);
        wasm.polygon_set_ps(this.__wbg_ptr, index, point.__wbg_ptr);
    }
    /**
     * @param {number} index
     * @param {Point} point
     */
    setPoint(index, point) {
        _assertClass(point, Point);
        wasm.polygon_setPoint(this.__wbg_ptr, index, point.__wbg_ptr);
    }
}
if (Symbol.dispose) Polygon.prototype[Symbol.dispose] = Polygon.prototype.free;

const RectangleFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_rectangle_free(ptr >>> 0, 1));

export class Rectangle {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Rectangle.prototype);
        obj.__wbg_ptr = ptr;
        RectangleFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RectangleFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_rectangle_free(ptr, 0);
    }
    /**
     * Convert rectangle to a polygon (for use with ShapeRef)
     * @returns {Polygon}
     */
    toPolygon() {
        const ret = wasm.rectangle_toPolygon(this.__wbg_ptr);
        return Polygon.__wrap(ret);
    }
    /**
     * Create a rectangle from two corner points
     * @param {Point} p1
     * @param {Point} p2
     * @returns {Rectangle}
     */
    static fromCorners(p1, p2) {
        _assertClass(p1, Point);
        _assertClass(p2, Point);
        const ret = wasm.rectangle_fromCorners(p1.__wbg_ptr, p2.__wbg_ptr);
        return Rectangle.__wrap(ret);
    }
    /**
     * Create a rectangle from center point, width, and height
     * @param {Point} center
     * @param {number} width
     * @param {number} height
     */
    constructor(center, width, height) {
        _assertClass(center, Point);
        const ret = wasm.rectangle_new(center.__wbg_ptr, width, height);
        this.__wbg_ptr = ret >>> 0;
        RectangleFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    width() {
        const ret = wasm.rectangle_width(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Point}
     */
    center() {
        const ret = wasm.rectangle_center(this.__wbg_ptr);
        return Point.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    height() {
        const ret = wasm.rectangle_height(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) Rectangle.prototype[Symbol.dispose] = Rectangle.prototype.free;

const RouterFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_router_free(ptr >>> 0, 1));

export class Router {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RouterFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_router_free(ptr, 0);
    }
    /**
     * Move shape by offset from current position
     * x_diff, y_diff are offsets (deltas) from current position, matching libavoid-js semantics
     * @param {ShapeRef} shape
     * @param {number} x_diff
     * @param {number} y_diff
     */
    moveShape(shape, x_diff, y_diff) {
        _assertClass(shape, ShapeRef);
        wasm.router_moveShape(this.__wbg_ptr, shape.__wbg_ptr, x_diff, y_diff);
    }
    /**
     * @param {ShapeRef} shape
     */
    deleteShape(shape) {
        _assertClass(shape, ShapeRef);
        wasm.router_deleteShape(this.__wbg_ptr, shape.__wbg_ptr);
    }
    /**
     * Add a connector to the router for routing
     * @param {ConnRef} conn
     */
    addConnector(conn) {
        _assertClass(conn, ConnRef);
        wasm.router_addConnector(this.__wbg_ptr, conn.__wbg_ptr);
    }
    /**
     * Move shape to a new polygon position
     * @param {ShapeRef} shape
     * @param {Polygon} new_polygon
     */
    moveShapeTo(shape, new_polygon) {
        _assertClass(shape, ShapeRef);
        _assertClass(new_polygon, Polygon);
        wasm.router_moveShapeTo(this.__wbg_ptr, shape.__wbg_ptr, new_polygon.__wbg_ptr);
    }
    /**
     * @param {number} option
     * @returns {boolean}
     */
    routingOption(option) {
        const ret = wasm.router_routingOption(this.__wbg_ptr, option);
        return ret !== 0;
    }
    /**
     * @param {ConnRef} conn
     */
    deleteConnector(conn) {
        _assertClass(conn, ConnRef);
        wasm.router_deleteConnector(this.__wbg_ptr, conn.__wbg_ptr);
    }
    /**
     * Update a connector's endpoints in the router
     * Call this after modifying connector endpoints to sync with router
     * @param {ConnRef} conn
     */
    updateConnector(conn) {
        _assertClass(conn, ConnRef);
        wasm.router_updateConnector(this.__wbg_ptr, conn.__wbg_ptr);
    }
    /**
     * @param {number} param
     * @returns {number}
     */
    routingParameter(param) {
        const ret = wasm.router_routingParameter(this.__wbg_ptr, param);
        return ret;
    }
    /**
     * @param {number} option
     * @param {boolean} value
     */
    setRoutingOption(option, value) {
        wasm.router_setRoutingOption(this.__wbg_ptr, option, value);
    }
    /**
     * Get the display route for a connector by ID
     * Use this after processTransaction to get the computed route
     * @param {number} conn_id
     * @returns {Polygon | undefined}
     */
    getConnectorRoute(conn_id) {
        const ret = wasm.router_getConnectorRoute(this.__wbg_ptr, conn_id);
        return ret === 0 ? undefined : Polygon.__wrap(ret);
    }
    /**
     * @returns {boolean}
     */
    processTransaction() {
        const ret = wasm.router_processTransaction(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Enable or disable transaction mode
     * When enabled, changes are batched until processTransaction is called
     * This is required for nudging to work correctly
     * @param {boolean} use_transactions
     */
    setTransactionUse(use_transactions) {
        wasm.router_setTransactionUse(this.__wbg_ptr, use_transactions);
    }
    /**
     * @param {number} param
     * @param {number} value
     */
    setRoutingParameter(param, value) {
        wasm.router_setRoutingParameter(this.__wbg_ptr, param, value);
    }
    /**
     * Output info about the router (for debugging)
     * @returns {string}
     */
    outputInstanceToSVG() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.router_outputInstanceToSVG(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Create a new router with the specified routing flags
     * flags should be PolyLineRouting (1) or OrthogonalRouting (2)
     * @param {number} flags
     */
    constructor(flags) {
        const ret = wasm.router_new(flags);
        this.__wbg_ptr = ret >>> 0;
        RouterFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Add a shape to the router for routing consideration
     * @param {ShapeRef} shape
     */
    addShape(shape) {
        _assertClass(shape, ShapeRef);
        wasm.router_addShape(this.__wbg_ptr, shape.__wbg_ptr);
    }
}
if (Symbol.dispose) Router.prototype[Symbol.dispose] = Router.prototype.free;

const ShapeConnectionPinFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_shapeconnectionpin_free(ptr >>> 0, 1));

export class ShapeConnectionPin {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ShapeConnectionPin.prototype);
        obj.__wbg_ptr = ptr;
        ShapeConnectionPinFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ShapeConnectionPinFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_shapeconnectionpin_free(ptr, 0);
    }
    /**
     * Get the visibility directions
     * @returns {number}
     */
    directions() {
        const ret = wasm.shapeconnectionpin_directions(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Check if this pin is exclusive
     * @returns {boolean}
     */
    isExclusive() {
        const ret = wasm.shapeconnectionpin_isExclusive(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Set whether this pin is exclusive
     * @param {boolean} exclusive
     */
    setExclusive(exclusive) {
        wasm.shapeconnectionpin_setExclusive(this.__wbg_ptr, exclusive);
    }
    /**
     * Create a connection pin on a junction
     * @param {JunctionRef} _junction
     * @param {number} class_id
     * @param {number | null} [vis_dirs]
     * @returns {ShapeConnectionPin}
     */
    static createOnJunction(_junction, class_id, vis_dirs) {
        _assertClass(_junction, JunctionRef);
        const ret = wasm.shapeconnectionpin_createOnJunction(_junction.__wbg_ptr, class_id, isLikeNone(vis_dirs) ? 0x100000001 : (vis_dirs) >>> 0);
        return ShapeConnectionPin.__wrap(ret);
    }
    /**
     * Set the connection cost for this pin
     * @param {number} cost
     */
    setConnectionCost(cost) {
        wasm.shapeconnectionpin_setConnectionCost(this.__wbg_ptr, cost);
    }
    /**
     * Create a connection pin on a shape
     * shape: The shape to attach the pin to
     * class_id: Class ID for grouping pins
     * x_offset: X offset from shape center (or proportion if proportional)
     * y_offset: Y offset from shape center (or proportion if proportional)
     * inside_offset: Offset inside the shape boundary
     * vis_dirs: Visibility directions (ConnDir flags)
     * @param {ShapeRef} shape
     * @param {number} class_id
     * @param {number} x_offset
     * @param {number} y_offset
     * @param {number} inside_offset
     * @param {number} vis_dirs
     */
    constructor(shape, class_id, x_offset, y_offset, inside_offset, vis_dirs) {
        _assertClass(shape, ShapeRef);
        const ret = wasm.shapeconnectionpin_new(shape.__wbg_ptr, class_id, x_offset, y_offset, inside_offset, vis_dirs);
        this.__wbg_ptr = ret >>> 0;
        ShapeConnectionPinFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get the pin's position
     * @returns {Point}
     */
    position() {
        const ret = wasm.box_min(this.__wbg_ptr);
        return Point.__wrap(ret);
    }
}
if (Symbol.dispose) ShapeConnectionPin.prototype[Symbol.dispose] = ShapeConnectionPin.prototype.free;

const ShapeRefFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_shaperef_free(ptr >>> 0, 1));

export class ShapeRef {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ShapeRef.prototype);
        obj.__wbg_ptr = ptr;
        ShapeRefFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ShapeRefFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_shaperef_free(ptr, 0);
    }
    /**
     * Updates the shape's polygon
     * @param {Polygon} polygon
     */
    setNewPoly(polygon) {
        _assertClass(polygon, Polygon);
        wasm.shaperef_setNewPoly(this.__wbg_ptr, polygon.__wbg_ptr);
    }
    /**
     * Create a ShapeRef with a specific ID
     * @param {Router} _router
     * @param {Polygon} polygon
     * @param {number} id
     * @returns {ShapeRef}
     */
    static createWithId(_router, polygon, id) {
        _assertClass(_router, Router);
        _assertClass(polygon, Polygon);
        const ret = wasm.shaperef_createWithId(_router.__wbg_ptr, polygon.__wbg_ptr, id);
        return ShapeRef.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    id() {
        const ret = wasm.shaperef_id(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {Router} router
     * @param {Polygon} polygon
     */
    constructor(router, polygon) {
        _assertClass(router, Router);
        _assertClass(polygon, Polygon);
        const ret = wasm.shaperef_new(router.__wbg_ptr, polygon.__wbg_ptr);
        this.__wbg_ptr = ret >>> 0;
        ShapeRefFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Returns the shape's polygon
     * @returns {Polygon}
     */
    polygon() {
        const ret = wasm.shaperef_polygon(this.__wbg_ptr);
        return Polygon.__wrap(ret);
    }
    /**
     * Returns the shape's position (center of bounding box)
     * @returns {Point}
     */
    position() {
        const ret = wasm.shaperef_position(this.__wbg_ptr);
        return Point.__wrap(ret);
    }
}
if (Symbol.dispose) ShapeRef.prototype[Symbol.dispose] = ShapeRef.prototype.free;

const EXPECTED_RESPONSE_TYPES = new Set(['basic', 'cors', 'default']);

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg___wbindgen_throw_b855445ff6a94295 = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
        ;
    };

    return imports;
}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();

    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }

    const instance = new WebAssembly.Instance(module, imports);

    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('libavoid_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
