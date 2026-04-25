glslangValidator $1 -C -G -g --auto-map-locations --auto-map-bindings -o tmp
spirv-opt tmp -O --target-env=opengl4.0 -o tmp2
spirv-cross tmp2 --es --version 300 > optimized.$1
rm tmp tmp2
