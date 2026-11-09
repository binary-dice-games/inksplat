# Finds Node.js and npm and installs the npm dependencies on first configure, and again when
# package-lock.json is newer than what was installed (a pull or a branch switch that changed the
# dependencies), like updating submodules.
#
# Sets INKSPLAT_NODE and INKSPLAT_NPM.

find_program(INKSPLAT_NODE node)
# On Windows npm is a .cmd file; the extensionless `npm` next to it is a shell script that
# CreateProcess cannot run, so ask for npm.cmd first.
find_program(INKSPLAT_NPM NAMES npm.cmd npm)
if(NOT INKSPLAT_NODE OR NOT INKSPLAT_NPM)
  message(FATAL_ERROR "inksplat needs Node.js 20+ and npm on PATH (see docs/building.md)")
endif()

set(_inksplat_installed "${CMAKE_CURRENT_SOURCE_DIR}/node_modules/.package-lock.json")
set(_inksplat_lock "${CMAKE_CURRENT_SOURCE_DIR}/package-lock.json")
# Configure again when the lock file changes, so a build after a pull installs what it needs.
if(EXISTS "${_inksplat_lock}")
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${_inksplat_lock}")
endif()
if(NOT EXISTS "${_inksplat_installed}"
   OR (EXISTS "${_inksplat_lock}" AND "${_inksplat_lock}" IS_NEWER_THAN "${_inksplat_installed}"))
  if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/package-lock.json")
    set(_inksplat_npm_install ci)
  else()
    set(_inksplat_npm_install install)
  endif()
  message(STATUS "inksplat: npm ${_inksplat_npm_install}")
  execute_process(
    COMMAND "${INKSPLAT_NPM}" ${_inksplat_npm_install} --no-audit --no-fund
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    RESULT_VARIABLE _inksplat_npm_result
    OUTPUT_VARIABLE _inksplat_npm_output
    ERROR_VARIABLE _inksplat_npm_output)
  if(NOT _inksplat_npm_result EQUAL 0)
    message(FATAL_ERROR "inksplat: npm ${_inksplat_npm_install} failed (${_inksplat_npm_result}):\n${_inksplat_npm_output}")
  endif()
endif()
