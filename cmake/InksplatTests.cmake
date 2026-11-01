# inksplat_add_test(<name> <test file> [PROJECT <vitest project>] [TIMEOUT <seconds>]
#                   [LABELS <label>...])
#
# Registers one Vitest file as its own ctest test (ctest runs every test in
# its own process, in parallel). PROJECT is `unit` (default) or `e2e`.
# TIMEOUT defaults to 120 seconds, 300 for `e2e`: a browser file runs many
# WebRTC sessions, and the macOS runner needs over two minutes for some.
# Node is run directly so Windows does not go through npm.cmd.
function(inksplat_add_test name file)
  cmake_parse_arguments(ARG "" "PROJECT;TIMEOUT" "LABELS" ${ARGN})
  if(NOT ARG_PROJECT)
    set(ARG_PROJECT unit)
  endif()
  if(NOT ARG_TIMEOUT)
    if(ARG_PROJECT STREQUAL "e2e")
      set(ARG_TIMEOUT 300)
    else()
      set(ARG_TIMEOUT 120)
    endif()
  endif()
  add_test(
    NAME ${name}
    COMMAND "${INKSPLAT_NODE}" node_modules/vitest/vitest.mjs run --project ${ARG_PROJECT} "${file}"
    WORKING_DIRECTORY "${PROJECT_SOURCE_DIR}")
  set_tests_properties(${name} PROPERTIES LABELS "${ARG_PROJECT};${ARG_LABELS}" TIMEOUT ${ARG_TIMEOUT})
endfunction()
