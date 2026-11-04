;; SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>
;;
;; SPDX-License-Identifier: Apache-2.0

(module
  ;; Host imports: 256MiB (4096 pages) fixed memory
  (import "env" "memory" (memory 4096 4096))

  ;; =========================================================================
  ;; Memory Layout Specification (managed by Host):
  ;;   Page 0 (0x000000..0x00FFFF, 64KiB):
  ;;     0x0000..0x041F (1056B): Query input vector [f32x256 + 0x8 pad]
  ;;                             Kernel zero-clears pad (offset 1024..1055).
  ;;   Page 1..16 (0x010000..0x10FFFF, 1MiB):
  ;;     Score output buffer: [f32] x $row_count (Max 262,144 scores)
  ;;   Page 17..4095 (0x110000..0x0FFFFFFF, 255MiB):
  ;;     Vector DB storage: [f32x256 + 0x8 pad] x N
  ;;     * CONTRACT: Host MUST guarantee that the 8-element padding
  ;;                 (32 bytes at row offset 1024..1055) is filled with 0.0f
  ;;                 to prevent NaN contamination.
  ;;     * Capacity: Up to 250,000 rows (safe limit).
  ;; =========================================================================

  (func (export "bdot264") (param $row_count i32)
    (local $db_row_ptr i32)
    (local $score_ptr  i32)
    (local $k_iter     i32)
    (local $db_ptr     i32)
    (local $query_ptr  i32)

    (local $zero    v128)
    (local $acc0    v128)
    (local $acc1    v128)
    (local $acc2    v128)
    (local $acc3    v128)
    (local $acc4    v128)
    (local $acc5    v128)
    (local $acc_sum v128)

    ;; --- Guards (Early Exit & Preconditions) ---
    (if (i32.eqz (local.get $row_count)) (then (return)))
    (if (i32.gt_u (local.get $row_count) (i32.const 250000)) (then (unreachable)))

    ;; Zero out query padding (dim 256..263 / offset 1024..1055, 32B)
    (v128.store offset=1024 (i32.const 0) (local.get $zero))
    (v128.store offset=1040 (i32.const 0) (local.get $zero))

    ;; Initialize pointers to partition layout
    (local.set $score_ptr  (i32.const 65536))   ;; 0x010000 (Page 1)
    (local.set $db_row_ptr (i32.const 1114112)) ;; 0x110000 (Page 17)

    ;; --- Row Loop ---
    loop $row
      (local.set $row_count (i32.sub (local.get $row_count) (i32.const 1)))
      (local.set $db_ptr    (local.get $db_row_ptr))
      (local.set $query_ptr (i32.const 0))
      (local.set $k_iter    (i32.const 11))

      ;; --- Inner Dot-Product Loop (11 iterations, 96B/iter) ---
      loop $k
        (local.set $k_iter (i32.sub (local.get $k_iter) (i32.const 1)))

        (local.set $acc0
          (f32x4.add (local.get $acc0)
            (f32x4.mul
              (v128.load offset=0  (local.get $db_ptr))
              (v128.load offset=0  (local.get $query_ptr)))))
        (local.set $acc1
          (f32x4.add (local.get $acc1)
            (f32x4.mul
              (v128.load offset=16 (local.get $db_ptr))
              (v128.load offset=16 (local.get $query_ptr)))))
        (local.set $acc2
          (f32x4.add (local.get $acc2)
            (f32x4.mul
              (v128.load offset=32 (local.get $db_ptr))
              (v128.load offset=32 (local.get $query_ptr)))))
        (local.set $acc3
          (f32x4.add (local.get $acc3)
            (f32x4.mul
              (v128.load offset=48 (local.get $db_ptr))
              (v128.load offset=48 (local.get $query_ptr)))))
        (local.set $acc4
          (f32x4.add (local.get $acc4)
            (f32x4.mul
              (v128.load offset=64 (local.get $db_ptr))
              (v128.load offset=64 (local.get $query_ptr)))))
        (local.set $acc5
          (f32x4.add (local.get $acc5)
            (f32x4.mul
              (v128.load offset=80 (local.get $db_ptr))
              (v128.load offset=80 (local.get $query_ptr)))))

        (local.set $db_ptr    (i32.add (local.get $db_ptr)    (i32.const 96)))
        (local.set $query_ptr (i32.add (local.get $query_ptr) (i32.const 96)))

        (br_if $k (local.get $k_iter))
      end

      ;; --- 6-Accumulator Tree Reduction ---
      (local.set $acc_sum
        (f32x4.add
          (f32x4.add
            (f32x4.add (local.get $acc0) (local.get $acc1))
            (f32x4.add (local.get $acc2) (local.get $acc3)))
          (f32x4.add (local.get $acc4) (local.get $acc5))))

      ;; --- Horizontal Sum & Store to Score Output Buffer ---
      (f32.store (local.get $score_ptr)
        (f32.add
          (f32.add
            (f32x4.extract_lane 0 (local.get $acc_sum))
            (f32x4.extract_lane 1 (local.get $acc_sum)))
          (f32.add
            (f32x4.extract_lane 2 (local.get $acc_sum))
            (f32x4.extract_lane 3 (local.get $acc_sum)))))

      ;; --- Reset Accumulators ---
      (local.set $acc0 (local.get $zero))
      (local.set $acc1 (local.get $zero))
      (local.set $acc2 (local.get $zero))
      (local.set $acc3 (local.get $zero))
      (local.set $acc4 (local.get $zero))
      (local.set $acc5 (local.get $zero))

      ;; --- Advance Pointers ---
      (local.set $db_row_ptr (i32.add (local.get $db_row_ptr) (i32.const 1056)))
      (local.set $score_ptr  (i32.add (local.get $score_ptr)  (i32.const 4)))

      (br_if $row (local.get $row_count))
    end
  )
)
