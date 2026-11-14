# SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
#
# SPDX-License-Identifier: Apache-2.0

# -*- encoding: utf-8 -*-
# Runs every backend unit test (tests/backend/**/*_test.rb): ruby tests/backend/run.rb [Minitest options], for example
# -n "/same millisecond/" to run the tests whose names match.
#
# Each file runs in a Ruby process of its own (helper.rb gives each process its own data directory, and the servers of
# the tests take free ports), as many at a time as there are CPUs (LCTY_TEST_JOBS to change it), the largest files
# first. A file's output is shown when it fails, or for every file when Minitest options are given; otherwise one line
# per file. The run fails when any file does.

require 'etc'
require 'open3'
require 'rbconfig'

files = Dir[File.join(__dir__, '**', '*_test.rb')].sort_by { |f| [-File.size(f), f] }
jobs = [Integer(ENV['LCTY_TEST_JOBS'] || Etc.nprocessors), 1].max
verbose = !ARGV.empty?
queue = Queue.new
files.each { |f| queue << f }
lock = Mutex.new
totals = Hash.new(0)
failed = []
started = Process.clock_gettime(Process::CLOCK_MONOTONIC)

# Without LANG the default external encoding is US-ASCII, as in lcty.rb (LCTYSP-0001): -E sets it to UTF-8
workers = Array.new([jobs, files.size].min) do
  Thread.new do
    while (file = (queue.pop(true) rescue nil))
      t = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      out, status = Open3.capture2e(RbConfig.ruby, '-E', 'UTF-8', file, *ARGV)
      took = Process.clock_gettime(Process::CLOCK_MONOTONIC) - t
      counts = out.scan(/^(\d+) runs, (\d+) assertions, (\d+) failures, (\d+) errors, (\d+) skips/).last
      name = file.sub("#{__dir__}/", '')
      lock.synchronize do
        %w[runs assertions failures errors skips].zip(counts || []).each { |k, v| totals[k] += v.to_i }
        failed << name unless status.success? && counts
        if !status.success? || !counts
          puts "==== #{name} (#{format('%.1f', took)} s)", out
        elsif verbose
          # A filter such as -n leaves most files with no runs: only the others are shown
          puts "==== #{name} (#{format('%.1f', took)} s)", out unless counts[0] == '0'
        else
          puts format('%-32s %5.1f s  %s', name, took, "#{counts[0]} runs, #{counts[2]} failures, #{counts[3]} errors")
        end
        $stdout.flush
      end
    end
  end
end
workers.each(&:join)

took = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
puts
puts "#{files.size} files in #{format('%.1f', took)} s with #{workers.size} processes: " \
     "#{totals['runs']} runs, #{totals['assertions']} assertions, #{totals['failures']} failures, " \
     "#{totals['errors']} errors, #{totals['skips']} skips"
puts "Failed: #{failed.sort.join(', ')}" unless failed.empty?
exit(failed.empty? ? 0 : 1)
