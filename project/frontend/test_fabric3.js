import * as fabric from 'fabric';
const canvas = new fabric.Canvas(null);
const rect = new fabric.Rect({width: 10, height: 10});
canvas.add(rect);
rect.set('selectable', false);
console.log(rect.selectable);
